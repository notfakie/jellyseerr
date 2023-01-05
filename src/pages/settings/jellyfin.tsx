import SettingsJellyfin from '@app/components/Settings/SettingsJellyfin';
import SettingsLayout from '@app/components/Settings/SettingsLayout';
import useRouteGuard from '@app/hooks/useRouteGuard';
import { Permission } from '@app/hooks/useUser';
import type { NextPage } from 'next';

const JellyfinSettingsPage: NextPage = () => {
  useRouteGuard(Permission.ADMIN);
  return (
    <SettingsLayout>
      <SettingsJellyfin showAdvancedSettings={true} />
    </SettingsLayout>
  );
};

export default JellyfinSettingsPage;
