---
title: "Cognito Account Linking: Connecting Multiple Identity Providers to One User"
---

## Cognito Account Linking: Connecting Multiple Identity Providers to One User

Imagine a user who signs up for your application using their Google account, then later tries to log in with Facebook, only to discover they've created a second account. They're now frustrated, their profile settings are scattered across two accounts, and you've lost the opportunity to build a unified user profile. This is the account linking problem that Amazon Cognito solves elegantly.

Account linking in AWS Cognito lets you connect identities from different providers—Google, Facebook, SAML, native Cognito, and others—to a single user account. From the user's perspective, they have one unified identity. From your application's perspective, you get a single user record regardless of which provider they chose on any given login. It's a powerful feature that improves user experience, reduces support friction, and gives you better data about your users.

In this article, we'll explore how account linking works, when and why you'd use it, the mechanics of how Cognito implements it, and the developer workflows for both automatic and manual linking scenarios.

### Understanding the Problem: Identity Fragmentation

Before we talk about solutions, let's be clear about the problem. OAuth 2.0 and SAML identities are provider-specific. A user's Google ID is completely distinct from their Facebook ID, even if they're the same person in the real world. Without explicit linking, these become separate accounts in your system.

Consider a practical scenario: you run a SaaS product that supports both email/password authentication and social login via Google. A new user discovers your product and signs up using Google OAuth. Months later, they recommend it to a colleague, who arrives at your app, clicks "Sign up," and chooses email/password. Both authenticate successfully, but your system treats them as two different users. The second login doesn't recognize the user's previous activity, subscriptions, or preferences.

This fragmentation costs you. Users get confused. Your support team handles duplicate account complaints. Your analytics become muddled. Analytics reports show more signups than actual unique users. Most importantly, you lose the opportunity to understand your user's full journey and preferences.

Account linking solves this by saying: "These two identities represent the same person, so let's treat them as one user account."

### How Cognito Account Linking Works

Cognito provides two primary mechanisms for account linking: **developer-initiated linking** and **identity pool-based linking**. They work in complementary ways, and which one you use depends on your architecture.

#### Developer-Initiated Linking

Developer-initiated linking is the explicit, managed approach. Your application detects that a user trying to authenticate might already have an account (typically through some identifier like email), and you programmatically link the new identity to the existing user account.

Here's the typical flow:

1. A user with an existing Cognito account (say, created via email/password) attempts to sign in using a social provider like Google.
2. Your application receives the Google identity token and extracts the email address.
3. Your backend queries Cognito to see if a user already exists with that email.
4. If a match is found, you call the `AdminLinkUserAttributes` API to link the Google identity to the existing user account.
5. From that point forward, the user can authenticate using either email/password or Google, and Cognito treats them as the same account.

This approach gives you fine-grained control. You decide when and how linking happens. You can implement business logic around it—for instance, requiring user confirmation before linking, or checking that email addresses match before proceeding.

#### Identity Pool-Based Linking

Cognito Identity Pools (Federated Identities) provide a different approach to linking. Rather than working at the user account level, Identity Pools work at the identity level. An identity in an Identity Pool is essentially a token that grants AWS credentials.

When you authenticate a user through an Identity Provider (like Cognito User Pools, Google, Facebook, or SAML), Cognito Identity Pools can map that identity to an existing identity in your pool rather than creating a new one. The linking happens based on attributes you specify, such as email address.

The key difference: User Pools link identities to *user accounts*, while Identity Pools link identities to *federated identities* (which grant AWS credentials). Both serve the purpose of unification, but they operate at different layers of your architecture.

### The API Operations Behind the Scenes

Let's examine the specific API calls that make developer-initiated linking work.

#### AdminLinkUserAttributes

The `AdminLinkUserAttributes` operation is your primary tool. It links user attributes from one provider's identity to an existing Cognito user account. You typically use this when you've authenticated a user with a social provider and you want to attach that identity to an existing account.

```bash
aws cognito-idp admin-link-user-attributes \
  --user-pool-id us-east-1_abc12345 \
  --username existing-user-id \
  --user-attributes Name=email,Value=user@example.com \
                    Name=email_verified,Value=true \
                    Name=identities,Value='google_abc123'
```

When you call this, you're telling Cognito: "For the user with username 'existing-user-id', add these attributes." The `identities` attribute is special—it's where Cognito stores the mapping to the external provider's ID.

In practice, you don't manually construct the `identities` attribute. Instead, Cognito manages it internally when you use the specialized `AdminLinkIdToken` operation.

#### AdminLinkIdToken

This operation is more direct. You provide an ID token from one provider, and Cognito links it to an existing user account.

```bash
aws cognito-idp admin-link-id-token \
  --user-pool-id us-east-1_abc12345 \
  --username existing-user@example.com \
  --id-token eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
```

Here, you're passing the actual ID token you received from authenticating with the external provider (Google, Facebook, SAML, etc.). Cognito validates the token, extracts the provider's unique identifier, and links it to the specified user.

This is cleaner than `AdminLinkUserAttributes` when you have a token in hand, because Cognito handles the identity extraction and formatting automatically.

### Real-World Linking Scenarios

Let's walk through some concrete scenarios to see how these pieces fit together.

#### Scenario 1: Email-Plus-Social Signup Flow

Your application allows users to sign up with either email/password or Google. You want to be smart about it: if someone signs up with Google using an email that matches an existing email account, link them automatically (or ask for permission first).

1. User A signs up using email and password. Cognito creates a user account.
2. Three weeks later, User A tries to log in with Google using the same email address.
3. Your app's backend receives the Google ID token and extracts the email claim.
4. You query Cognito's User Pool to find a user with that email address.
5. You find User A's existing account.
6. You call `AdminLinkIdToken`, passing the existing username and the Google ID token.
7. Cognito validates the token, extracts the Google unique ID, and creates an internal link.
8. Now, when User A logs in with Google, Cognito recognizes the Google ID, resolves it to the same user account, and authentication succeeds.

#### Scenario 2: SAML Enterprise Onboarding

Your SaaS product serves enterprise customers. You support SAML single sign-on for larger organizations. A new enterprise customer wants to enable SAML, and you need to link the SAML identities to existing user accounts (which were created when those users first signed up via email or social).

1. You bulk-load a list of users from the customer's SAML IdP.
2. For each user, you identify the matching Cognito user account (perhaps via email).
3. You obtain an ID token from the SAML provider (or construct one through an authentication flow).
4. You call `AdminLinkIdToken` for each user, linking their SAML identity to their existing Cognito account.
5. The next time that user authenticates via SAML, they're seamlessly logged into their existing account.

#### Scenario 3: Multi-Provider Linking Without Pre-Existing Accounts

Not all linking scenarios involve a pre-existing account. Sometimes, you want to link identities from multiple providers on first signup, with no pre-existing account.

1. User arrives and clicks "Sign up with Google."
2. Google authentication succeeds. Cognito creates a new user account tied to the Google identity.
3. Later, the user decides they also want to be able to log in with Facebook.
4. Your app's backend receives a Facebook ID token from a re-authentication flow.
5. You call `AdminLinkIdToken`, linking the Facebook identity to the same user account.
6. Now, the user can authenticate using either Google or Facebook.

### Handling Identity Collisions

A subtle but important problem emerges when you scale account linking: what happens when two different users both own the same linking attribute? For example, what if two users both have the same email address (which can happen if your email validation wasn't strict initially)?

This is an **identity collision**. Cognito doesn't automatically resolve these; you must handle them explicitly in your application logic.

Here are some strategies:

**Email Verification Before Linking**: Require that the email address be verified (via a confirmation email) before attempting a link. This reduces the chance of fraudulent or erroneous links. Cognito provides the `email_verified` attribute for exactly this purpose.

**User Confirmation Flow**: Don't link automatically. Instead, notify the user that a linking opportunity exists and ask for explicit confirmation. This gives users control and reduces the risk of account compromise. For example: "We detected you have a Google account with this email. Would you like to link it to your existing account?"

**Attribute Uniqueness Constraints**: When setting up your Cognito User Pool, mark certain attributes (like email) as unique if they're critical to your business logic. Cognito will prevent multiple users from having the same value for that attribute, eliminating collisions at the source.

**Audit and Rollback**: Log all linking operations. If a collision is detected after the fact, you can audit the operation and, if necessary, unlink the identities using `AdminUnlinkUserAttributes`.

### Implementation Best Practices

Here are some proven practices for implementing account linking securely and reliably:

**Verify Tokens Before Linking**: Always validate that the ID token you're about to link is genuine and hasn't expired. The token's claims should match what you expect. Cognito validates this when you call `AdminLinkIdToken`, but you should also validate on the client side before sending it to your backend.

**Link Only Verified Attributes**: Prioritize linking based on verified attributes like verified email addresses. An unverified email address can be spoofed, but a verified one has gone through a confirmation flow, making it more trustworthy.

**Implement Rate Limiting**: If you're allowing users to initiate linking themselves (e.g., "Link my Google account" in settings), rate-limit the operation to prevent abuse. An attacker could otherwise spam link requests.

**Log All Linking Operations**: Create an audit trail. Log which identities were linked, when, and by whom (user-initiated or admin-initiated). This helps you troubleshoot issues and detect suspicious activity.

**Plan for Unlinking**: Users should have the ability to unlink identities if they change their mind or detect unauthorized linking. Implement an `unlink` flow using `AdminUnlinkUserAttributes` and expose it through your settings UI.

**Test with Multiple Providers**: If you support multiple external identity providers, test the linking flow with each one. Token formats and claim structures can vary, and what works with Google might break with Facebook or SAML.

### Linking in the Context of Identity Pools

If you're using Cognito Identity Pools in addition to User Pools, the linking picture becomes slightly more complex but also more powerful.

Identity Pools sit downstream of User Pools. They take an authenticated identity (from a User Pool, external provider, or unauthenticated session) and exchange it for temporary AWS credentials.

When you configure an Identity Pool with User Pool as an authentication provider, Cognito automatically creates a link between the User Pool user and an identity in the Identity Pool. But you can also manually configure an Identity Pool to recognize multiple authentication sources (e.g., both your User Pool and a SAML provider) as the same identity.

Here's the flow:

1. User authenticates via Google through your User Pool, receiving an ID token and access token.
2. You pass the ID token to the Cognito Identity Pool.
3. Identity Pool recognizes the token, looks it up in your configuration, and maps it to an identity.
4. Identity Pool returns temporary AWS credentials for that identity.
5. If the same user later authenticates via SAML and you've configured the Identity Pool to recognize SAML as an alternative provider for that identity, they receive credentials for the same identity and thus the same AWS role and permissions.

This means your AWS permissions are tied to the unified identity, not the individual provider. That's powerful for applications that use AWS services directly (mobile apps, web apps with client-side AWS SDK usage).

### Practical Code Example: Linking Flow

Let's tie this together with a simplified backend example. Imagine you're building a Node.js backend that handles a user signing up or logging in with Google, and you want to link Google to an existing email account if one exists.

```javascript
const AWS = require('aws-sdk');
const cognito = new AWS.CognitoIdentityServiceProvider();

async function linkGoogleIdentity(googleIdToken, userPoolId) {
  // Step 1: Decode the Google ID token and extract the email
  // (In production, validate the signature properly)
  const decodedToken = JSON.parse(Buffer.from(googleIdToken.split('.')[1], 'base64').toString());
  const googleEmail = decodedToken.email;

  // Step 2: Query the User Pool for a user with this email
  const listParams = {
    UserPoolId: userPoolId,
    Filter: `email = "${googleEmail}"`
  };

  let existingUser;
  try {
    const result = await cognito.listUsers(listParams).promise();
    if (result.Users.length > 0) {
      existingUser = result.Users[0];
    }
  } catch (error) {
    console.error('Error querying User Pool:', error);
    throw error;
  }

  // Step 3: If a user exists, link the Google identity
  if (existingUser) {
    const linkParams = {
      UserPoolId: userPoolId,
      Username: existingUser.Username,
      IdToken: googleIdToken
    };

    try {
      await cognito.adminLinkIdToken(linkParams).promise();
      console.log(`Linked Google identity to user: ${existingUser.Username}`);
      return { linked: true, username: existingUser.Username };
    } catch (error) {
      console.error('Error linking identity:', error);
      throw error;
    }
  }

  // Step 4: No existing user; the user will be created new
  return { linked: false };
}
```

This simplified example shows the core logic: extract an email from the incoming token, find an existing user with that email, and if found, link the identity. The actual production implementation would need token validation, error handling, collision detection, and probably a user confirmation step.

### Security Considerations

Account linking touches sensitive territory: you're essentially saying two authentication credentials should grant access to the same account. This requires care.

**Prevent Privilege Escalation**: Imagine an attacker discovers your email address and creates a Cognito account with it. If your app automatically links any identity with matching email to existing accounts without verification, the attacker could link a malicious provider to your account and take over. Always require verification (email confirmation or explicit user consent) before linking.

**Validate Token Expiry and Signatures**: When you receive a token to link, verify it's not expired and that the signature is valid. `AdminLinkIdToken` does some of this for you, but implementing additional client-side validation is good defense in depth.

**Support Account Recovery**: If an attacker does compromise and link a malicious identity to your account, you need a recovery mechanism. Ensure users can unlink identities, change their email, or reset their password. Require password verification before unlinking if the linking happened via social providers.

**Audit and Monitor**: Log linking events with timestamps, usernames, and provider information. Monitor for unusual patterns, like a single user account getting linked to many identities in a short time (which might indicate account takeover).

### Conclusion

Account linking in AWS Cognito transforms fragmented identities into a unified user experience. By connecting multiple providers—email, Google, Facebook, SAML, or others—to a single user account, you reduce friction, improve user satisfaction, and gain a clearer view of your user base.

The core operations are straightforward: `AdminLinkUserAttributes` and `AdminLinkIdToken` do the heavy lifting. The nuance lies in the surrounding logic: deciding when to link, verifying attributes, handling collisions, and recovering from mishaps.

Whether you're building a consumer app that supports social login, a SaaS product enabling enterprise SAML, or anything in between, account linking is a key feature for smoothing the authentication experience. Start with a clear policy about when linking happens, implement identity verification, and always give users control and visibility over their linked identities. Done well, account linking becomes invisible to your users—they simply have one account, regardless of which provider they choose on any given day.
