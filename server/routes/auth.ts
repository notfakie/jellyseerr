import JellyfinAPI from '@server/api/jellyfin';
import PlexTvAPI from '@server/api/plextv';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';
import gravatarUrl from 'gravatar-url';

const authRoutes = Router();

authRoutes.get('/me', isAuthenticated(), async (req, res) => {
  const userRepository = getRepository(User);
  if (!req.user) {
    return res.status(500).json({
      status: 500,
      error: 'Please sign in.',
    });
  }
  const user = await userRepository.findOneOrFail({
    where: { id: req.user.id },
  });

  return res.status(200).json(user);
});

authRoutes.post('/plex', async (req, res, next) => {
  const settings = getSettings();
  const userRepository = getRepository(User);
  const body = req.body as { authToken?: string };

  if (!body.authToken) {
    return next({
      status: 500,
      message: 'Authentication token required.',
    });
  }
  try {
    // First we need to use this auth token to get the user's email from plex.tv
    const plextv = new PlexTvAPI(body.authToken);
    const account = await plextv.getUser();

    let user: User | null;

    // If we are already logged in, we should just get the currently logged in user
    // otherwise we will try to match to an existing users email or plex ID
    if (req.user) {
      user = await userRepository.findOneBy({ id: req.user.id });
    } else {
      user = await userRepository
        .createQueryBuilder('user')
        .where('user.plexId = :id', { id: account.id })
        .orWhere('user.email = :email', {
          email: account.email.toLowerCase(),
        })
        .getOne();
    }

    if (!user && !(await userRepository.count())) {
      user = new User({
        email: account.email,
        plexUsername: account.username,
        plexId: account.id,
        plexToken: account.authToken,
        permissions: Permission.ADMIN,
        avatar: account.thumb,
      });

      await userRepository.save(user);
    } else {
      const mainUser = await userRepository.findOneOrFail({
        select: { id: true, plexToken: true, plexId: true, email: true },
        where: { id: 1 },
      });
      const mainPlexTv = new PlexTvAPI(mainUser.plexToken ?? '');

      if (!account.id) {
        logger.error('Plex ID was missing from Plex.tv response', {
          label: 'API',
          ip: req.ip,
          email: account.email,
          plexUsername: account.username,
        });

        return next({
          status: 500,
          message: 'Something went wrong. Try again.',
        });
      }

      if (
        account.id === mainUser.plexId ||
        (user && user.id === 1 && !user.plexId) ||
        (account.email === mainUser.email && !mainUser.plexId) ||
        (await mainPlexTv.checkUserAccess(account.id))
      ) {
        if (user) {
          if (!user.plexId) {
            logger.info(
              'Found matching Plex user; updating user with Plex data. Notice: Emails are no longer synced.',
              {
                label: 'API',
                ip: req.ip,
                email: user.email,
                userId: user.id,
                plexId: account.id,
                plexUsername: account.username,
              }
            );
          }

          user.plexToken = body.authToken;
          user.plexId = account.id;
          user.avatar = account.thumb;
          user.plexUsername = account.username;

          await userRepository.save(user);
        } else if (!settings.main.newPlexLogin) {
          logger.warn(
            'Failed sign-in attempt by unimported Plex user with access to the media server',
            {
              label: 'API',
              ip: req.ip,
              email: account.email,
              plexId: account.id,
              plexUsername: account.username,
            }
          );
          return next({
            status: 403,
            message: 'Access denied.',
          });
        } else {
          logger.info(
            'Sign-in attempt from Plex user with access to the media server; creating new Overseerr user',
            {
              label: 'API',
              ip: req.ip,
              email: account.email,
              plexId: account.id,
              plexUsername: account.username,
            }
          );
          user = new User({
            email: account.email,
            plexUsername: account.username,
            plexId: account.id,
            plexToken: account.authToken,
            permissions: settings.main.defaultPermissions,
            avatar: account.thumb,
          });

          await userRepository.save(user);
        }
      } else {
        logger.warn(
          'Failed sign-in attempt by Plex user without access to the media server',
          {
            label: 'API',
            ip: req.ip,
            email: account.email,
            plexId: account.id,
            plexUsername: account.username,
          }
        );
        return next({
          status: 403,
          message: 'Access denied.',
        });
      }
    }

    // Set logged in session
    if (req.session) {
      req.session.userId = user.id;
    }

    return res.status(200).json(user?.filter() ?? {});
  } catch (e) {
    logger.error('Something went wrong authenticating with Plex account', {
      label: 'API',
      errorMessage: e.message,
      ip: req.ip,
    });
    return next({
      status: 500,
      message: 'Unable to authenticate.',
    });
  }
});

authRoutes.get('/plex/unlink', isAuthenticated(), async (req, res, next) => {
  const userRepository = getRepository(User);
  try {
    if (!req.user) {
      throw new Error('User data is not present in request.');
    }

    const user = await userRepository.findOneByOrFail({ id: req.user.id });

    if (!user.isLocalUser) {
      throw new Error('User must have a local password set to unlink Plex.');
    }

    user.plexId = null;
    user.plexToken = null;
    user.avatar = gravatarUrl(user.email, { default: 'mm', size: 200 });
    user.plexUsername = null;

    await userRepository.save(user);

    return res.status(204).send();
  } catch (e) {
    logger.error('Something went wrong unlinking a Plex account', {
      label: 'API',
      errorMessage: e.message,
      userId: req.user?.id,
    });
    return next({
      status: 500,
      message: 'Unable to unlink plex account.',
    });
  }
});

authRoutes.post('/jellyfin', async (req, res, next) => {
  const settings = getSettings();
  const userRepository = getRepository(User);
  const body = req.body as {
    username?: string;
    password?: string;
    hostname?: string;
    email?: string;
  };

  //Make sure jellyfin login is enabled, but only if jellyfin is not already configured
  // if (
  //   settings.main.mediaServerType !== MediaServerType.JELLYFIN &&
  //   settings.jellyfin.hostname !== ''
  // ) {
  //   return res.status(500).json({ error: 'Jellyfin login is disabled' });
  // } else if (!body.username) {
  if (!body.username) {
    return res.status(500).json({ error: 'You must provide an username' });
  } else if (settings.jellyfin.hostname === '' && !body.hostname) {
    return res.status(500).json({ error: 'No hostname provided.' });
  }

  try {
    const hostname =
      settings.jellyfin.hostname !== ''
        ? settings.jellyfin.hostname
        : body.hostname ?? '';
    const { externalHostname } = getSettings().jellyfin;

    const mainUser = await userRepository.findOneOrFail({
      select: { id: true, email: true },
      where: { id: 1 },
    });

    if (!mainUser) {
      logger.error(
        'Sign-in attempt from Jellyfin user before local user was setup',
        {
          label: 'API',
          ip: req.ip,
        }
      );
      return next({
        status: 403,
        message: 'Access denied.',
      });
    }

    // Try to find deviceId that corresponds to jellyfin user, else generate a new one
    let user = await userRepository.findOne({
      where: { jellyfinUsername: body.username },
    });

    let deviceId = '';
    if (user) {
      deviceId = user.jellyfinDeviceId ?? '';
    } else {
      deviceId = Buffer.from(`BOT_overseerr_${body.username ?? ''}`).toString(
        'base64'
      );
    }

    // First we need to attempt to log the user in to jellyfin
    const jellyfinserver = new JellyfinAPI(hostname ?? '', undefined, deviceId);
    let jellyfinHost =
      externalHostname && externalHostname.length > 0
        ? externalHostname
        : hostname;

    jellyfinHost = jellyfinHost.endsWith('/')
      ? jellyfinHost.slice(0, -1)
      : jellyfinHost;

    const account = await jellyfinserver.login(body.username, body.password);

    // If we are already logged in, we should just get the currently logged in user
    // otherwise we will try to match to an existing users jellyfin ID
    if (req.user) {
      user = await userRepository.findOneBy({ id: req.user.id });
    } else {
      user = await userRepository
        .createQueryBuilder('user')
        .where('user.jellyfinUserId = :id', { id: account.User.Id })
        .getOne();
    }

    if (user) {
      // Let's check if their authtoken is up to date
      if (user.jellyfinAuthToken !== account.AccessToken) {
        user.jellyfinAuthToken = account.AccessToken;
      }

      //set jellyfin userId for initial setup
      if (!user.jellyfinUserId) {
        user.jellyfinUserId = account.User.Id;
      }
      user.jellyfinDeviceId = deviceId;

      // Update the users avatar with their jellyfin profile pic (incase it changed)
      if (account.User.PrimaryImageTag) {
        user.avatar = `${jellyfinHost}/Users/${account.User.Id}/Images/Primary/?tag=${account.User.PrimaryImageTag}&quality=90`;
      } else {
        user.avatar = '/os_logo_square.png';
      }

      user.jellyfinUsername = account.User.Name;

      if (user.username === account.User.Name) {
        user.username = '';
      }

      //Update hostname in settings if it doesn't exist (initial configuration)
      if (settings.jellyfin.hostname === '' && body.hostname) {
        // settings.main.mediaServerType = MediaServerType.JELLYFIN;
        settings.jellyfin.hostname = body.hostname ?? '';
        settings.jellyfin.serverId = account.User.ServerId;
        settings.save();
        // startJobs();
      }

      await userRepository.save(user);
    } else if (!settings.main.newPlexLogin) {
      logger.warn(
        'Failed sign-in attempt by unimported Jellyfin user with access to the media server',
        {
          label: 'API',
          ip: req.ip,
          jellyfinUserId: account.User.Id,
          jellyfinUsername: account.User.Name,
        }
      );
      return next({
        status: 403,
        message: 'Access denied.',
      });
    } else {
      logger.info(
        'Sign-in attempt from Jellyfin user with access to the media server; creating Overseerr user',
        {
          label: 'API',
          ip: req.ip,
          jellyfinUsername: account.User.Name,
        }
      );

      if (!body.email) {
        throw new Error('add_email');
      }

      user = new User({
        email: body.email,
        jellyfinUsername: account.User.Name,
        jellyfinUserId: account.User.Id,
        jellyfinDeviceId: deviceId,
        jellyfinAuthToken: account.AccessToken,
        permissions: settings.main.defaultPermissions,
        avatar: account.User.PrimaryImageTag
          ? `${jellyfinHost}/Users/${account.User.Id}/Images/Primary/?tag=${account.User.PrimaryImageTag}&quality=90`
          : '/os_logo_square.png',
      });
      await userRepository.save(user);
    }

    if (!user) {
      logger.error(
        'Sign-in attempt from Jellyfin user without a matching local Overseerr user',
        {
          label: 'API',
          ip: req.ip,
          jellyfinUsername: account.User.Name,
        }
      );
      return next({
        status: 403,
        message: 'Access denied.',
      });
    }

    // Set logged in session
    if (req.session) {
      req.session.userId = user?.id;
    }

    return res.status(200).json(user?.filter() ?? {});
  } catch (e) {
    if (e.message === 'Unauthorized') {
      logger.info(
        'Failed login attempt from user with incorrect Jellyfin credentials',
        {
          label: 'Auth',
          account: {
            ip: req.ip,
            email: body.username,
            password: '__REDACTED__',
          },
        }
      );
      return next({
        status: 401,
        message: 'Unauthorized',
      });
    } else if (e.message === 'add_email') {
      return next({
        status: 406,
        message: 'CREDENTIAL_ERROR_ADD_EMAIL',
      });
    } else {
      logger.error(e.message, { label: 'Auth' });
      return next({
        status: 500,
        message: 'Something went wrong.',
      });
    }
  }
});

authRoutes.post('/local', async (req, res, next) => {
  const settings = getSettings();
  const userRepository = getRepository(User);
  const body = req.body as { email?: string; password?: string };

  if (!settings.main.localLogin) {
    return res.status(500).json({ error: 'Password sign-in is disabled.' });
  } else if (!body.email || !body.password) {
    return res.status(500).json({
      error: 'You must provide both an email address and a password.',
    });
  }
  try {
    let user = await userRepository
      .createQueryBuilder('user')
      .select(['user.id', 'user.email', 'user.password', 'user.plexId'])
      .where('user.email = :email', { email: body.email.toLowerCase() })
      .getOne();

    if (!user && !(await userRepository.count())) {
      const avatar = gravatarUrl(body.email, { default: 'mm', size: 200 });
      user = new User({
        email: body.email,
        permissions: Permission.ADMIN,
        avatar,
      });
      await user.setPassword(body.password);
      await userRepository.save(user);
    } else if (!user || !(await user.passwordMatch(body.password))) {
      logger.warn('Failed sign-in attempt using invalid Overseerr password', {
        label: 'API',
        ip: req.ip,
        email: body.email,
        userId: user?.id,
      });
      return next({
        status: 403,
        message: 'Access denied.',
      });
    }

    const mainUser = await userRepository.findOne({
      select: { id: true, plexToken: true, plexId: true },
      where: { id: 1 },
    });
    const mainPlexTv = new PlexTvAPI(mainUser?.plexToken ?? '');

    if (!user.plexId && mainUser?.isPlexUser) {
      try {
        const plexUsersResponse = await mainPlexTv.getUsers();
        const account = plexUsersResponse.MediaContainer.User.find(
          (account) =>
            account.$.email &&
            account.$.email.toLowerCase() === user?.email.toLowerCase()
        )?.$;

        if (
          account &&
          (await mainPlexTv.checkUserAccess(parseInt(account.id)))
        ) {
          logger.info(
            'Found matching Plex user; updating user with Plex data',
            {
              label: 'API',
              ip: req.ip,
              email: body.email,
              userId: user.id,
              plexId: account.id,
              plexUsername: account.username,
            }
          );

          user.plexId = parseInt(account.id);
          user.avatar = account.thumb;
          user.email = account.email;
          user.plexUsername = account.username;

          await userRepository.save(user);
        }
      } catch (e) {
        logger.error('Something went wrong fetching Plex users', {
          label: 'API',
          errorMessage: e.message,
        });
      }
    }

    if (
      mainUser?.isPlexUser &&
      user.plexId &&
      user.plexId !== mainUser.plexId &&
      !(await mainPlexTv.checkUserAccess(user.plexId))
    ) {
      logger.warn(
        'Failed sign-in attempt from Plex user without access to the media server',
        {
          label: 'API',
          account: {
            ip: req.ip,
            email: body.email,
            userId: user.id,
            plexId: user.plexId,
          },
        }
      );
      return next({
        status: 403,
        message: 'Access denied.',
      });
    }

    // Set logged in session
    if (req.session) {
      req.session.userId = user.id;
    }

    return res.status(200).json(user?.filter() ?? {});
  } catch (e) {
    logger.error(
      'Something went wrong authenticating with Overseerr password',
      {
        label: 'API',
        errorMessage: e.message,
        ip: req.ip,
        email: body.email,
      }
    );
    return next({
      status: 500,
      message: 'Unable to authenticate.',
    });
  }
});

authRoutes.post('/logout', (req, res, next) => {
  req.session?.destroy((err) => {
    if (err) {
      return next({
        status: 500,
        message: 'Something went wrong.',
      });
    }

    return res.status(200).json({ status: 'ok' });
  });
});

authRoutes.post('/reset-password', async (req, res, next) => {
  const userRepository = getRepository(User);
  const body = req.body as { email?: string };

  if (!body.email) {
    return next({
      status: 500,
      message: 'Email address required.',
    });
  }

  const user = await userRepository
    .createQueryBuilder('user')
    .where('user.email = :email', { email: body.email.toLowerCase() })
    .getOne();

  if (user) {
    await user.resetPassword();
    userRepository.save(user);
    logger.info('Successfully sent password reset link', {
      label: 'API',
      ip: req.ip,
      email: body.email,
    });
  } else {
    logger.error('Something went wrong sending password reset link', {
      label: 'API',
      ip: req.ip,
      email: body.email,
    });
  }

  return res.status(200).json({ status: 'ok' });
});

authRoutes.post('/reset-password/:guid', async (req, res, next) => {
  const userRepository = getRepository(User);

  if (!req.body.password || req.body.password?.length < 8) {
    logger.warn('Failed password reset attempt using invalid new password', {
      label: 'API',
      ip: req.ip,
      guid: req.params.guid,
    });
    return next({
      status: 500,
      message: 'Password must be at least 8 characters long.',
    });
  }

  const user = await userRepository.findOne({
    where: { resetPasswordGuid: req.params.guid },
  });

  if (!user) {
    logger.warn('Failed password reset attempt using invalid recovery link', {
      label: 'API',
      ip: req.ip,
      guid: req.params.guid,
    });
    return next({
      status: 500,
      message: 'Invalid password reset link.',
    });
  }

  if (
    !user.recoveryLinkExpirationDate ||
    user.recoveryLinkExpirationDate <= new Date()
  ) {
    logger.warn('Failed password reset attempt using expired recovery link', {
      label: 'API',
      ip: req.ip,
      guid: req.params.guid,
      email: user.email,
    });
    return next({
      status: 500,
      message: 'Invalid password reset link.',
    });
  }

  await user.setPassword(req.body.password);
  user.recoveryLinkExpirationDate = null;
  userRepository.save(user);
  logger.info('Successfully reset password', {
    label: 'API',
    ip: req.ip,
    guid: req.params.guid,
    email: user.email,
  });

  return res.status(200).json({ status: 'ok' });
});

export default authRoutes;
