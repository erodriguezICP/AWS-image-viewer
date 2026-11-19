import type { PreSignUpTriggerHandler } from 'aws-lambda';

export const handler: PreSignUpTriggerHandler = async (event) => {
  const email = event.request.userAttributes.email
    ?.toLowerCase()
    .trim();

  if (!email) {
    throw new Error('An email address is required.');
  }

  const domain = email.split('@').pop();

  if (domain !== 'icp.org') {
    throw new Error(
      'Registration is restricted to authorized ICP email accounts.'
    );
  }

  return event;
};
