import Button from '@app/components/Common/Button';
import useSettings from '@app/hooks/useSettings';
import axios from 'axios';
import { Field, Form, Formik } from 'formik';
import getConfig from 'next/config';
import type React from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import * as Yup from 'yup';

const messages = defineMessages({
  username: 'Username',
  password: 'Password',
  host: '{mediaServerName} URL',
  validationhostrequired: '{mediaServerName} URL required',
  validationhostformat: 'Valid URL required',
  validationusernamerequired: 'Username required',
  validationpasswordrequired: 'Password required',
  loginerror: 'Something went wrong while trying to sign in.',
  credentialerror: 'The username or password is incorrect.',
  signingin: 'Signing in…',
  signin: 'Sign In',
  initialsigningin: 'Connecting…',
  initialsignin: 'Connect',
  forgotpassword: 'Forgot Password?',
});

interface JellyfinLoginProps {
  revalidate: () => void;
  initial?: boolean;
}

const JellyfinLogin: React.FC<JellyfinLoginProps> = ({
  revalidate,
  initial,
}) => {
  const toasts = useToasts();
  const intl = useIntl();
  const settings = useSettings();
  const { publicRuntimeConfig } = getConfig();

  if (initial) {
    const LoginSchema = Yup.object().shape({
      host: Yup.string()
        .matches(
          /^(?:(?:(?:https?):)?\/\/)(?:\S+(?::\S*)?@)?(?:(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*\.?)(?::\d{2,5})?(?:[/?#]\S*)?$/,
          intl.formatMessage(messages.validationhostformat)
        )
        .required(
          intl.formatMessage(messages.validationhostrequired, {
            mediaServerName:
              publicRuntimeConfig.JELLYFIN_TYPE == 'emby' ? 'Emby' : 'Jellyfin',
          })
        ),
      username: Yup.string().required(
        intl.formatMessage(messages.validationusernamerequired)
      ),
      password: Yup.string(),
    });
    return (
      <Formik
        initialValues={{
          username: '',
          password: '',
          host: '',
        }}
        validationSchema={LoginSchema}
        onSubmit={async (values) => {
          try {
            await axios.post('/api/v1/auth/jellyfin', {
              username: values.username,
              password: values.password,
              hostname: values.host,
            });
          } catch (e) {
            toasts.addToast(
              intl.formatMessage(
                e.message == 'Request failed with status code 401'
                  ? messages.credentialerror
                  : messages.loginerror
              ),
              {
                autoDismiss: true,
                appearance: 'error',
              }
            );
          } finally {
            revalidate();
          }
        }}
      >
        {({ errors, touched, isSubmitting, isValid }) => (
          <Form>
            <div className="sm:border-t sm:border-gray-800">
              <label htmlFor="host" className="text-label">
                {intl.formatMessage(messages.host, {
                  mediaServerName:
                    publicRuntimeConfig.JELLYFIN_TYPE == 'emby'
                      ? 'Emby'
                      : 'Jellyfin',
                })}
              </label>
              <div className="mt-1 mb-2 sm:col-span-2 sm:mt-0">
                <div className="flex rounded-md shadow-sm">
                  <Field
                    id="host"
                    name="host"
                    type="text"
                    placeholder={intl.formatMessage(messages.host, {
                      mediaServerName:
                        publicRuntimeConfig.JELLYFIN_TYPE == 'emby'
                          ? 'Emby'
                          : 'Jellyfin',
                    })}
                  />
                </div>
                {errors.host && touched.host && (
                  <div className="error">{errors.host}</div>
                )}
              </div>
              <label htmlFor="username" className="text-label">
                {intl.formatMessage(messages.username)}
              </label>
              <div className="mt-1 mb-2 sm:col-span-2 sm:mt-0">
                <div className="flex rounded-md shadow-sm">
                  <Field
                    id="username"
                    name="username"
                    type="text"
                    placeholder={intl.formatMessage(messages.username)}
                  />
                </div>
                {errors.username && touched.username && (
                  <div className="error">{errors.username}</div>
                )}
              </div>
              <label htmlFor="password" className="text-label">
                {intl.formatMessage(messages.password)}
              </label>
              <div className="mt-1 mb-2 sm:col-span-2 sm:mt-0">
                <div className="flexrounded-md shadow-sm">
                  <Field
                    id="password"
                    name="password"
                    type="password"
                    placeholder={intl.formatMessage(messages.password)}
                  />
                </div>
                {errors.password && touched.password && (
                  <div className="error">{errors.password}</div>
                )}
              </div>
            </div>
            <div className="mt-8 border-t border-gray-700 pt-5">
              <div className="flex justify-end">
                <span className="inline-flex rounded-md shadow-sm">
                  <Button
                    buttonType="primary"
                    type="submit"
                    disabled={isSubmitting || !isValid}
                  >
                    {isSubmitting
                      ? intl.formatMessage(messages.signingin)
                      : intl.formatMessage(messages.signin)}
                  </Button>
                </span>
              </div>
            </div>
          </Form>
        )}
      </Formik>
    );
  } else {
    const LoginSchema = Yup.object().shape({
      username: Yup.string().required(
        intl.formatMessage(messages.validationusernamerequired)
      ),
      password: Yup.string(),
    });
    return (
      <div>
        <Formik
          initialValues={{
            username: '',
            password: '',
          }}
          validationSchema={LoginSchema}
          onSubmit={async (values) => {
            try {
              await axios.post('/api/v1/auth/jellyfin', {
                username: values.username,
                password: values.password,
              });
            } catch (e) {
              toasts.addToast(
                intl.formatMessage(
                  e.message == 'Request failed with status code 401'
                    ? messages.credentialerror
                    : messages.loginerror
                ),
                {
                  autoDismiss: true,
                  appearance: 'error',
                }
              );
            } finally {
              revalidate();
            }
          }}
        >
          {({ errors, touched, isSubmitting, isValid }) => {
            return (
              <>
                <Form>
                  <div className="sm:border-t sm:border-gray-800">
                    <label htmlFor="username" className="text-label">
                      {intl.formatMessage(messages.username)}
                    </label>
                    <div className="mt-1 mb-2 sm:col-span-2 sm:mt-0">
                      <div className="flex max-w-lg rounded-md shadow-sm">
                        <Field
                          id="username"
                          name="username"
                          type="text"
                          placeholder={intl.formatMessage(messages.username)}
                        />
                      </div>
                      {errors.username && touched.username && (
                        <div className="error">{errors.username}</div>
                      )}
                    </div>
                    <label htmlFor="password" className="text-label">
                      {intl.formatMessage(messages.password)}
                    </label>
                    <div className="mt-1 mb-2 sm:col-span-2 sm:mt-0">
                      <div className="flex max-w-lg rounded-md shadow-sm">
                        <Field
                          id="password"
                          name="password"
                          type="password"
                          placeholder={intl.formatMessage(messages.password)}
                        />
                      </div>
                      {errors.password && touched.password && (
                        <div className="error">{errors.password}</div>
                      )}
                    </div>
                  </div>
                  <div className="mt-8 border-t border-gray-700 pt-5">
                    <div className="flex justify-between">
                      <span className="inline-flex rounded-md shadow-sm">
                        <Button
                          as="a"
                          buttonType="ghost"
                          href={
                            publicRuntimeConfig.JELLYFIN_TYPE == 'emby'
                              ? settings.currentSettings.jellyfinHost +
                                '/web/index.html#!/startup/forgotpassword.html'
                              : settings.currentSettings.jellyfinHost +
                                '/web/index.html#!/forgotpassword.html'
                          }
                        >
                          {intl.formatMessage(messages.forgotpassword)}
                        </Button>
                      </span>
                      <span className="inline-flex rounded-md shadow-sm">
                        <Button
                          buttonType="primary"
                          type="submit"
                          disabled={isSubmitting || !isValid}
                        >
                          {isSubmitting
                            ? intl.formatMessage(messages.signingin)
                            : intl.formatMessage(messages.signin)}
                        </Button>
                      </span>
                    </div>
                  </div>
                </Form>
              </>
            );
          }}
        </Formik>
      </div>
    );
  }
};

export default JellyfinLogin;
