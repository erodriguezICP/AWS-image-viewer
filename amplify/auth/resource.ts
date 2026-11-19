import { defineAuth } from '@aws-amplify/backend';
import { preSignUp } from './pre-sign-up/resource';

/**
 * Define and configure the authentication resource.
 *
 * Users sign in with their email address.
 * The preSignUp Lambda validates that new accounts
 * use an authorized ICP email domain.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },

  triggers: {
    preSignUp,
  },
});
