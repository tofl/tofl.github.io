---
title: "Cognito User Pools vs Identity Pools: Two Services, Two Purposes"
---

## Cognito User Pools vs Identity Pools: Two Services, Two Purposes

When I first started working with AWS Cognito, I made the same mistake countless developers do: I assumed User Pools and Identity Pools were interchangeable tools that did roughly the same thing. They're not. Understanding the distinction between them is one of those foundational moments that transforms your ability to build secure, scalable authentication systems on AWS—and it's exactly the kind of practical knowledge that separates developers who build with confidence from those who fumble through trial and error.

The confusion is understandable. Both services live under the Cognito umbrella. Both deal with identities. Both appear in similar architectural diagrams. But they solve fundamentally different problems, and they operate at different points in your security architecture. User Pools handle *authentication*—proving you are who you claim to be. Identity Pools handle *authorization*—determining what AWS resources you're allowed to access.

In this article, we'll untangle this critical distinction, explore when you need each service alone and when you need them together, and walk through the practical patterns you'll encounter as you build real applications on AWS.

### Understanding Authentication vs Authorization

Before we dive into the specifics of each Cognito service, let's establish clear definitions. These terms are often used loosely in conversation, but they mean precise things in security architecture.

**Authentication** answers the question: "Who are you?" It's the process of verifying someone's identity. When you sign into your bank's website with your username and password, you're authenticating. The system confirms that you are indeed the person you claim to be. In AWS terms, authentication typically produces proof of identity—usually in the form of a token or credential.

**Authorization** answers a different question: "What are you allowed to do?" Once the system knows who you are, it determines which resources you can access and what actions you can perform. If you authenticate as a customer of that same bank, you're authorized to view your own account balance but not someone else's. You're authorized to transfer money from your own checking account but not to delete the bank's entire database.

This distinction matters because they're distinct security concerns. You might want to let users authenticate through one mechanism but control their access to resources through a completely different system. You might trust one identity provider to authenticate users but maintain your own authorization rules. Or you might want to let external identity providers (like Google or Facebook) handle authentication while you manage authorization entirely yourself.

AWS Cognito gives you two separate services to handle these two concerns, and understanding where each one fits is essential.

### Introducing Cognito User Pools: Authentication

Cognito User Pools is, at its core, a fully managed authentication and user management service. Think of it as a dedicated identity provider you can host entirely on AWS without managing any servers or infrastructure.

A User Pool is essentially a user directory. When you create one, you're setting up a service that can do the following: store user credentials securely, validate usernames and passwords, send verification emails, enforce password policies, manage password resets, implement multi-factor authentication, and generate cryptographically signed tokens that prove a user's identity.

When a user signs up for your application, they create an account in your User Pool. When they sign in, the User Pool validates their credentials and, if everything checks out, returns tokens—specifically an ID token and an access token, both in JWT format. These tokens contain claims about the user's identity and can be passed along with requests to prove who the user is.

Let's look at a simple example. Imagine you're building a note-taking application. A user opens your app and sees a sign-in screen. They enter their username and password. Your app sends these credentials to your Cognito User Pool via the Cognito API. The User Pool validates the credentials against its stored user records. If they're correct, it returns an ID token and an access token. Your application now knows who the user is and can store those tokens to use for subsequent requests.

The ID token is particularly important here. It's a JWT that contains identity claims—information about who the user is. It might include the user's email, their user ID, when they signed in, and any custom attributes you've defined for users. When your application needs to know who the current user is, it can decode and verify the ID token. Because it's signed with your User Pool's private key, your application can trust that the token wasn't forged or tampered with.

The access token, on the other hand, is designed for authorizing API calls to protected resources. However, in the context of a User Pool alone, those protected resources are typically the User Pool's own endpoints—like the one for changing a user's password or retrieving their profile information.

### Introducing Cognito Identity Pools: Authorization

Cognito Identity Pools serves an entirely different purpose. Where User Pools handle authentication, Identity Pools handle authorization to AWS resources. An Identity Pool (sometimes called a Federated Identity or Cognito Identities) is a service that exchanges identity credentials for temporary AWS credentials.

Here's the conceptual leap that often confuses people: an Identity Pool doesn't care *how* you proved who you are. It doesn't care if you authenticated through Cognito User Pools, through a social identity provider like Google, through your enterprise Active Directory via SAML, or through any other identity provider. What an Identity Pool cares about is: "You've proven you're someone. Now, what AWS resources should this someone be allowed to access?"

An Identity Pool does this by exchanging your identity credentials (whatever they are) for temporary STS credentials—specifically, an access key, secret access key, and session token. These credentials are scoped to specific AWS permissions, defined by an IAM role that you attach to the Identity Pool.

Let's extend our note-taking application example. Now suppose you want users to be able to upload photos directly to S3 to attach to their notes. You don't want files routed through your backend server. Instead, you want the browser to upload directly to S3, which is more efficient and scalable. But you only want users to upload to their own folder within your S3 bucket.

This is where an Identity Pool shines. After a user authenticates with your User Pool and receives an ID token, they can exchange that ID token with your Identity Pool. The Identity Pool will generate temporary AWS credentials scoped to an IAM role that permits uploading to `s3://my-notes-bucket/user-${userId}/*`. Now the user's browser has temporary credentials to make that specific S3 request without your backend server having to act as an intermediary.

The beauty of this system is that the temporary credentials are time-limited. By default, they expire after one hour. After that, the user would need to exchange their identity credentials again to get a new set of temporary credentials. This limits the blast radius if credentials are somehow exposed.

### The Critical Difference: When You Need Each One

Now that you understand what each service does, let's talk about when you actually need them in your architecture.

**You need only a User Pool if:** Your application authenticates users but doesn't require those users to access AWS resources directly. For example, if you're building a web application where all data lives in a traditional database (RDS, DynamoDB, etc.) that your backend server accesses, and users authenticate to use your application but never directly call AWS APIs, then a User Pool alone is sufficient. The User Pool authenticates the user and provides tokens that your backend can validate. Your backend then makes its own calls to AWS resources using its own credentials or an IAM role.

**You need only an Identity Pool if:** You're confident that users don't need a separate identity provider and all authentication can be handled through temporary AWS credentials or other non-traditional means. This is less common in practice but does happen. For instance, some IoT scenarios or internal tools might skip traditional authentication entirely and rely on other mechanisms.

**You need both together, which is the most common pattern:** Your application needs to authenticate users (User Pool) and also needs those users to access AWS resources directly (Identity Pool). A web app where users upload files to S3, a mobile app that reads from DynamoDB, or a real-time application using IoT Core—these all benefit from combining both services. Users authenticate through the User Pool, receive an ID token, then exchange that ID token with the Identity Pool to get temporary AWS credentials for resource access.

### The Federated Identity Flow in Detail

When you combine User Pools and Identity Pools, a specific flow emerges that you'll see in nearly every production AWS application. Let's walk through it step by step because understanding this flow is crucial.

First, the user authenticates. They open your application and sign in using User Pool credentials (or through a social provider if you've configured that). The User Pool returns an ID token and an access token. These tokens are JWTs that cryptographically prove the user's identity according to your User Pool.

Second, the application needs to exchange this identity proof for AWS credentials. Your application calls the Cognito Identity Pool's `GetCredentialsForIdentity` API (or, more commonly, `GetId` followed by `GetCredentialsForIdentity`). In this call, you pass the ID token (or other proof of identity) to the Identity Pool.

The Identity Pool validates the identity token. If it's valid and hasn't expired, the Identity Pool looks up or creates an identity ID for this user and determines which IAM role this identity should assume. If you've configured the Identity Pool to use an authenticated role for users who have logged in, it will use that role. If the user isn't authenticated, it might use an unauthenticated role instead, with much more restricted permissions.

The Identity Pool then makes an STS `AssumeRole` call on your behalf, assuming the appropriate IAM role. STS generates temporary credentials bound to that role and returns them to your application.

Your application now possesses temporary AWS credentials that it can use to access services like S3, DynamoDB, IoT, or any other AWS service the assumed role permits. The browser, mobile app, or backend service can use these credentials to make direct API calls to AWS.

When the temporary credentials expire, the application repeats the flow: it uses its stored identity credentials (the ID token) to exchange for a fresh set of temporary AWS credentials.

This architecture is elegant because it completely decouples authentication from authorization. Your User Pool handles the one-time authentication challenge. Your Identity Pool handles the ongoing question of "what are you allowed to do right now," with the ability to frequently refresh credentials without re-authenticating.

### Tokens and Their Roles

Cognito generates different types of tokens, and each serves a specific purpose. Understanding them prevents misunderstandings about what each token is for.

The **ID token** is a JWT that contains claims about the user's identity. It's designed to be read by your application to learn facts about the authenticated user. It contains fields like `sub` (subject, which is the user ID), `email`, `email_verified`, `cognito:username`, and any custom attributes you've defined. The ID token is what you typically decode on your frontend to display the user's name or make UI decisions about what to show them.

The **access token** is also a JWT but with a different purpose. It's designed to be sent along with API requests to authorize those requests. The access token contains scopes—permissions that describe what the token holder is allowed to do. In the context of a User Pool alone, these scopes often relate to operations against the User Pool itself, like reading user attributes or changing passwords.

The **refresh token** is different. It's an opaque string (not a JWT) that your application stores securely and uses to get fresh ID and access tokens without requiring the user to log in again. When your ID and access tokens expire, you send the refresh token to the User Pool's token endpoint, and it returns new tokens. Refresh tokens are long-lived—they might be valid for days or weeks—which allows users to stay logged in across application restarts without constantly re-entering their credentials.

When you're working with an Identity Pool, you're typically exchanging the ID token (your proof of identity) for temporary AWS credentials. The Identity Pool validates the ID token, and if it's legitimate, you get credentials.

### Practical Implementation with Amplify Auth

If you're building on AWS, you've probably encountered AWS Amplify, which abstracts much of the complexity of setting up authentication. Understanding how Amplify Auth maps to Cognito User Pools and Identity Pools deepens your understanding of both.

When you configure Amplify Auth for your application, you're configuring both a Cognito User Pool (which Amplify calls "auth") and optionally a Cognito Identity Pool (which Amplify calls "identityPool"). Amplify's `Auth` module handles the User Pool operations—sign-up, sign-in, password resets, and token management. Under the hood, Amplify stores your ID and access tokens in the browser's local storage (for web apps) or the device's secure storage (for mobile apps).

When you need to access AWS resources directly, Amplify automatically handles the exchange with the Identity Pool. If you call an Amplify API that requires AWS credentials—like `Storage.get()` to read from S3 or `Predictions.identify()` for machine learning—Amplify checks if you have valid temporary credentials. If not, it exchanges your stored ID token with the Identity Pool to get fresh credentials, then makes the API call. All of this happens transparently to your application code.

Here's what a typical Amplify Auth setup looks like in code. First, you'd configure Amplify with your User Pool and Identity Pool details:

```javascript
import { Amplify } from 'aws-amplify';

Amplify.configure({
  Auth: {
    region: 'us-east-1',
    userPoolId: 'us-east-1_abcd1234',
    userPoolWebClientId: 'abcd1234efgh5678',
    identityPoolId: 'us-east-1:12345678-1234-1234-1234-123456789012',
  },
});
```

Then, signing a user in:

```javascript
import { Auth } from 'aws-amplify';

const user = await Auth.signIn(username, password);
// User Pool authenticates, returns tokens, and Amplify stores them
```

At this point, Amplify has your ID token stored. If you then call an operation that requires AWS credentials, like uploading to S3:

```javascript
import { Storage } from 'aws-amplify';

await Storage.put('my-photo.jpg', file);
// Amplify exchanges the ID token with the Identity Pool for credentials,
// then uses those credentials to upload to S3
```

This seamless integration is one reason Amplify is popular—it handles the User Pool and Identity Pool dance automatically. But understanding what's happening under the hood makes you a better architect and troubleshooter.

### IAM Roles and Access Control

For an Identity Pool to actually authorize actions, it needs to know which IAM role to assume. This is where IAM roles come into play, and it's critical to get this right.

When you create an Identity Pool, you configure two IAM roles: an authenticated role and an unauthenticated role. The authenticated role is assumed by users who have successfully authenticated (through a User Pool or other identity provider). The unauthenticated role is assumed by users who are trying to access resources without authenticating.

The unauthenticated role typically has very restricted permissions—maybe just the ability to read certain public resources or upload to a specific bucket folder for unregistered users. The authenticated role can have broader permissions, reflecting the trust you've established in the user's identity.

Consider our note-taking app again. The authenticated role might have permissions to read and write to the user's folder in S3:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::my-notes-bucket/users/${aws:username}/*"
    }
  ]
}
```

Notice the `${aws:username}` policy variable. This is a Cognito-specific policy variable that gets replaced with the actual user's username when the policy is evaluated. This means each user can only access their own folder—even though they all have the same role, the policy restricts their access based on their identity.

The unauthenticated role might allow users to only upload to a temporary folder:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::my-notes-bucket/temp/*"
    }
  ]
}
```

By carefully designing these IAM roles, you're essentially writing your authorization policy. The Identity Pool becomes the enforcement mechanism for that policy by issuing credentials bound to these roles.

### Common Architectural Patterns

Let me walk you through a few real-world scenarios to show how User Pools and Identity Pools work together in practice.

**Pattern 1: Traditional Web Application** You're building a multi-user web app where users sign up, sign in, and manage their data. You authenticate users through a Cognito User Pool. Your backend server is the primary consumer of AWS resources—it reads from DynamoDB, writes to S3, etc. Users never directly call AWS APIs. The frontend sends requests to your backend server, which validates the User Pool tokens and then accesses AWS resources with its own IAM credentials. In this pattern, you might not need an Identity Pool at all. The User Pool provides authentication, and your backend handles authorization to AWS resources.

**Pattern 2: Mobile App with Direct AWS Access** You're building a mobile app where users upload photos, which get stored in S3. You want uploads to happen directly from the device to S3, not through your backend, to save bandwidth and reduce latency. You set up a Cognito User Pool for authentication. After users sign in, you exchange their User Pool tokens with a Cognito Identity Pool to get temporary S3 credentials. The mobile app then uploads photos directly to S3 using those credentials. Your backend might still have an API, but certain operations bypass it entirely through direct AWS access. This pattern absolutely requires both a User Pool and an Identity Pool.

**Pattern 3: Social Identity** You're building a web app and want users to be able to sign in with Google or Facebook. You set up a Cognito User Pool and configure it to accept sign-in through external identity providers. When a user chooses to sign in with Google, the flow goes through Google, not the User Pool directly, but the result is still User Pool tokens (or federated tokens that Cognito creates). If you also want users to access AWS resources directly, you'd set up an Identity Pool configured to accept tokens from your User Pool as well as from Google and Facebook. After a user signs in through any provider, they can exchange their identity tokens with the Identity Pool. The Identity Pool doesn't care which provider authenticated them—it just needs a valid identity assertion.

**Pattern 4: IoT Application** You're building an IoT application where embedded devices need to publish metrics to AWS IoT Core. Each device is a "user" in your system. You create device identities in Cognito and use an Identity Pool to issue temporary credentials for IoT Core access. The devices use these credentials to publish messages. This is a less common pattern but shows how the Identity Pool concept extends beyond traditional users.

### Potential Pitfalls and Troubleshooting

Even with a solid understanding of User Pools and Identity Pools, there are several common mistakes that trip up developers.

One frequent mistake is misconfiguring the Identity Pool to not trust the User Pool. An Identity Pool sits between the identity provider (User Pool, Google, Active Directory, etc.) and your AWS resources. You must explicitly configure which identity providers the Identity Pool will accept. If you don't add your User Pool as a trusted provider to your Identity Pool, when users try to exchange their User Pool tokens for AWS credentials, the Identity Pool will reject them. Check your Identity Pool's authentication providers section to ensure your User Pool is listed.

Another mistake is confusing token scopes. Some developers try to use an ID token (which contains identity information) as an authorization token for AWS resources. This doesn't work. The ID token is for your application to know who the user is. The authorization for AWS resources comes through the temporary credentials issued by the Identity Pool. If you're trying to make an AWS API call and getting permission denied errors, make sure you're using the right credentials—temporary credentials from the Identity Pool, not tokens from the User Pool.

A third pitfall is not handling token refresh properly. Both ID tokens and access tokens expire (typically after an hour). Refresh tokens last longer (days or weeks) but are also finite. If your application doesn't implement refresh token logic, users will suddenly find themselves logged out. Amplify handles this automatically, but if you're managing tokens directly, you need to catch token expiration errors and refresh them before retrying.

Less common but important: not understanding that Identity Pool credentials are time-limited. If your application caches temporary AWS credentials and tries to use them hours later, they'll have expired, and the request will fail. Always assume credentials might expire and have a refresh mechanism in place.

Finally, overly permissive IAM roles are a security risk. It's tempting to give your authenticated role broad permissions to test something quickly, but this violates the principle of least privilege. Always scope IAM permissions as narrowly as possible. Use policy variables like `${aws:username}` to bind permissions to specific users. Use conditions to restrict what resources can be accessed and when.

### When to Use Federation

Federation is a pattern where you integrate external identity providers with your Cognito setup. This is worth understanding as a distinct pattern because it changes how User Pools and Identity Pools interact.

With federation, you're saying: "I trust this external identity provider to authenticate users. I don't want to manage usernames and passwords myself. Instead, I want to let users sign in through Google, Facebook, an enterprise Active Directory, or another SAML provider."

When you configure federation in a Cognito User Pool, you're adding an identity provider. Users can then sign in through that provider, and Cognito will create a token for them. The token represents successful authentication through that external provider.

The advantage is that you offload authentication complexity. You're not responsible for secure password storage or managing password resets. The external provider handles that. The disadvantage is that you depend on that external provider's availability and security. If Google's authentication service goes down, your users can't sign in.

Federation becomes particularly powerful when combined with an Identity Pool. Your Identity Pool can be configured to accept tokens from multiple sources: your User Pool, Google, Facebook, and a SAML provider all at once. A user who signs in through any of these will get a token that they can exchange with the Identity Pool for AWS credentials. This provides flexibility—different users can use different authentication mechanisms, but they all end up with the same AWS access (scoped to the authenticated IAM role).

### Conclusion

Cognito User Pools and Identity Pools are separate services solving separate problems, and the confusion between them is entirely understandable—they're interconnected in typical architectures and often used together. But clarity on their distinct purposes is foundational to building secure, scalable AWS applications.

User Pools handle authentication. They prove who you are. They store your identity securely and generate tokens that prove that identity. Use them when you need to manage users and validate their credentials.

Identity Pools handle authorization. They take proof of who you are and exchange it for temporary AWS credentials bound to specific permissions. Use them when users need to access AWS resources directly.

Most real-world applications use both. Users authenticate through a User Pool, receive identity tokens, exchange those tokens with an Identity Pool, and receive temporary credentials to access AWS services. This architecture cleanly separates authentication concerns from authorization concerns, allows you to swap identity providers without changing your AWS permissions model, and keeps credentials time-limited and scoped to specific resources.

As you design your next application on AWS, think about whether you need to authenticate users, whether you need them to access AWS resources directly, and whether federation through external identity providers makes sense. Your answers to these questions will determine whether you need just a User Pool, just an Identity Pool, or both working in concert. Master this distinction, and you'll find yourself building authentication systems with clarity and confidence.
