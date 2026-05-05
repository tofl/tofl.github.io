---
title: "Using AWS STS AssumeRoleWithWebIdentity for Mobile and Web Apps"
---

## Using AWS STS AssumeRoleWithWebIdentity for Mobile and Web Apps

Building modern applications often means grappling with a fundamental security challenge: how do you grant mobile users and web app clients direct access to AWS resources without embedding long-term credentials in client code? This is where AWS Security Token Service (STS) and the AssumeRoleWithWebIdentity API become indispensable tools. Rather than shipping permanent AWS access keys alongside your application, you can leverage identity providers to issue temporary, short-lived credentials that expire automatically. This approach transforms your security posture from one that's fragile and difficult to rotate into one that's robust, auditable, and genuinely aligned with AWS best practices.

In this article, we'll explore how AssumeRoleWithWebIdentity works, when you should reach for it, how it integrates with services like Amazon Cognito Identity Pools, and how to implement it in a real application.

### Understanding the Problem: Why You Can't Just Embed AWS Credentials

Imagine you're building a mobile app that needs to upload photos directly to Amazon S3, or a single-page application that queries Amazon DynamoDB. Your first instinct might be to generate IAM access keys, embed them in the app, and call it done. But this approach is fundamentally problematic.

When you bundle AWS credentials into a mobile app or a frontend JavaScript bundle, those credentials become part of the compiled or distributed code. Anyone with access to your app—whether through decompilation, network inspection, or GitHub repository scanning—can extract those keys. Even if you try to hide them, they're discoverable. Once exposed, these credentials grant the same permissions to an attacker as they do to your legitimate users. Rotating them means redeploying your entire application. This isn't a security measure; it's a security liability.

The alternative is to issue temporary credentials dynamically. This is where the STS service and web identity federation shine. Instead of embedding permanent credentials, you embed your identity provider configuration. At runtime, your app exchanges an identity token (from Google, Facebook, or Amazon Cognito) for short-lived AWS credentials. Those credentials exist only in memory, expire within minutes or hours, and are specific to that user's session. When they expire, your app quietly fetches a new set.

### How AssumeRoleWithWebIdentity Works

At its core, AssumeRoleWithWebIdentity is an STS API call that exchanges an identity token for temporary AWS credentials. The flow is elegant and worth understanding in detail.

**The actors involved** are your mobile or web app (the client), an identity provider (IdP) like Google, Facebook, or Amazon Cognito, an IAM role with trust policies, and the STS service. Your app doesn't directly authenticate with AWS; instead, it authenticates with the identity provider first, receives an identity token, and then trades that token to STS for temporary credentials.

Here's what happens step by step. First, your application presents the user with a login flow—perhaps a sign-in button for Google, Facebook, or an Amazon Cognito-hosted UI. The user authenticates with the identity provider using their credentials. The identity provider, if the authentication succeeds, returns an identity token (a JWT, or JSON Web Token) to your app. This token is a cryptographically signed assertion that says, "This user is Alice, and I (the identity provider) vouch for them."

Next, your app takes that identity token and calls the STS AssumeRoleWithWebIdentity API, passing the token along with the ARN of an IAM role you've configured to trust that identity provider. STS receives the request, verifies the token's signature against the identity provider's public key, checks that the role trusts this specific identity provider, and if everything checks out, issues a set of temporary credentials: an access key, a secret access key, and a session token.

Your app now has temporary AWS credentials with the permissions attached to the role. It uses these credentials to make AWS API calls directly—uploading to S3, writing to DynamoDB, or calling other AWS services. Critically, these credentials are temporary. By default, they last for one hour, though you can adjust this. When they expire, the app repeats the process.

This model has profound security implications. The credentials in your app are ephemeral, scoped to a specific user and session, and useless after expiration. You can revoke access by modifying the role's trust policy or attached permissions without touching the app itself. And because the exchange happens at runtime, each session gets fresh credentials, making credential rotation automatic and transparent.

### Integrating with Amazon Cognito Identity Pools

While you can use AssumeRoleWithWebIdentity directly with third-party identity providers like Google or Facebook, AWS provides a purpose-built integration through Amazon Cognito Identity Pools. Cognito Identity simplifies the federation process and adds powerful features like support for both authenticated and unauthenticated access, credential caching, and seamless integration with other Cognito services.

An Identity Pool is essentially a gateway that bridges your users' identities (from any supported provider) to AWS roles. You configure the pool to trust one or more identity providers—Google, Facebook, Amazon Cognito User Pools, or any OpenID Connect provider. You then create IAM roles within your AWS account that the pool is allowed to assume, and you attach different roles for authenticated users and unauthenticated guests.

When your app gets an identity token from a provider, it exchanges it with the Cognito Identity Pool for a Cognito identity ID and temporary AWS credentials. Behind the scenes, Cognito is calling AssumeRoleWithWebIdentity on your behalf, handling all the token validation and role assumption logic. This abstraction makes your app code simpler.

Consider a concrete example. You're building a photo-sharing app with a backend Cognito User Pool (for user registration and sign-in) and an Identity Pool (for granting AWS access). Your flow is straightforward: the user signs in via the Cognito User Pool, receives a User Pool token, and then exchanges that token with the Identity Pool for S3 credentials. The user then uploads photos directly to S3, bypassing your backend entirely for this operation. Your backend is freed up to handle business logic rather than proxying file uploads.

The Identity Pool handles multiple providers elegantly. If you support both Google and Facebook login, you can link both providers to the same Identity Pool. When a user authenticates with either provider, they get the same Cognito identity ID and access to the same AWS resources. This means users can sign in with different providers on different devices and still access their own data, with the Identity Pool maintaining consistent identity across federated logins.

### Key Differences: Cognito Identity Pools vs. Direct AssumeRoleWithWebIdentity

While Cognito Identity Pools abstract away much of the complexity, it's worth understanding when you might use AssumeRoleWithWebIdentity directly.

If you're building a tight integration with a single third-party identity provider and you want full control over the token validation and credential issuance process, calling AssumeRoleWithWebIdentity directly offers simplicity. You skip the intermediate Cognito layer and go straight to STS. This is common when you're integrating with your organization's own OpenID Connect provider or when you already have deep investment in a particular authentication system.

Cognito Identity Pools, on the other hand, excel when you want to support multiple identity providers, need features like credential caching or offline access, or benefit from the integration with other Cognito services like User Pools or Sync. They're also ideal for consumer-facing apps where simplicity and multi-provider support are valuable.

For most modern mobile and web applications, Cognito Identity Pools are the recommended path. AWS maintains the underlying infrastructure, handles OpenID Connect discovery for you, and provides SDKs that abstract the entire flow. But understanding the direct AssumeRoleWithWebIdentity path is valuable when you need flexibility or are working with non-standard providers.

### Setting Up the IAM Trust Relationship

Regardless of which path you take, the critical piece of configuration happens in your IAM role's trust policy. This policy defines which identity providers can assume the role and under what conditions.

A trust policy for AssumeRoleWithWebIdentity looks like this:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "accounts.google.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "accounts.google.com:aud": "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"
        }
      }
    }
  ]
}
```

The trust policy uses the Federated principal type, not an AWS account principal. It specifies the identity provider (accounts.google.com for Google, or the endpoint of your Cognito Identity Pool), the allowed action (sts:AssumeRoleWithWebIdentity), and conditions that must be met. The condition typically checks the audience claim (aud) in the token, ensuring the token was issued for your specific application.

For Cognito Identity Pools, the trust policy is slightly different:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "cognito-identity.amazonaws.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "cognito-identity.amazonaws.com:aud": "YOUR_IDENTITY_POOL_ID"
        },
        "ForAllValues:StringLike": {
          "cognito-identity.amazonaws.com:sub": "*"
        }
      }
    }
  ]
}
```

Notice that the Federated principal is cognito-identity.amazonaws.com, and the audience is your Identity Pool ID. The conditions ensure only your Cognito Identity Pool can assume the role.

Beyond the trust policy, you'll attach a permissions policy that defines what actions the temporary credentials can perform. This is where you apply the principle of least privilege, granting only the permissions users actually need. For a photo-sharing app, for example, you might allow PutObject on a specific S3 bucket and DynamoDB reads on a metadata table, but nothing else.

### Implementing AssumeRoleWithWebIdentity in a Mobile App

Let's build a concrete example: a React Native mobile app that uploads photos to S3 after the user authenticates with Google.

First, set up your AWS resources. Create an IAM role for authenticated users with this trust policy (using Google as the IdP):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "accounts.google.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "accounts.google.com:aud": "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"
        }
      }
    }
  ]
}
```

Attach a permissions policy allowing S3 uploads:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::your-photo-bucket/uploads/${aws:userid}/*"
    }
  ]
}
```

Notice the ${aws:userid} variable—this is a policy variable that gets replaced with the unique identifier from your federated user, ensuring users can only upload to their own prefix.

Now, in your React Native app, implement the flow. First, install the necessary packages:

```bash
npm install @react-native-google-signin/google-signin aws-sdk
```

Next, integrate Google sign-in and exchange the token for AWS credentials:

```javascript
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import AWS from 'aws-sdk';

// Configure Google Sign-in
GoogleSignin.configure({
  webClientId: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
});

// Sign in with Google and get AWS credentials
async function signInAndGetAWSCredentials() {
  try {
    // Authenticate with Google
    const userInfo = await GoogleSignin.signIn();
    const idToken = userInfo.idToken;

    // Create an STS client
    const sts = new AWS.STS();

    // Assume the role with the web identity token
    const response = await sts.assumeRoleWithWebIdentity({
      RoleArn: 'arn:aws:iam::YOUR_ACCOUNT_ID:role/PhotoUploaderRole',
      RoleSessionName: `mobile-session-${userInfo.user.id}`,
      WebIdentityToken: idToken,
      DurationSeconds: 3600, // 1 hour
    }).promise();

    // Extract temporary credentials
    const credentials = response.Credentials;

    // Configure AWS SDK with temporary credentials
    AWS.config.credentials = new AWS.Credentials(
      credentials.AccessKeyId,
      credentials.SecretAccessKey,
      credentials.SessionToken
    );

    return credentials;
  } catch (error) {
    console.error('Sign-in failed:', error);
    throw error;
  }
}

// Upload a photo to S3
async function uploadPhoto(photoUri) {
  try {
    // Ensure we have fresh credentials
    await signInAndGetAWSCredentials();

    // Create S3 client
    const s3 = new AWS.S3();

    // Read the photo file
    const photoData = await readFile(photoUri);

    // Upload to S3
    const uploadParams = {
      Bucket: 'your-photo-bucket',
      Key: `uploads/${AWS.config.credentials.data.IdentityId}/${Date.now()}.jpg`,
      Body: photoData,
      ContentType: 'image/jpeg',
    };

    const response = await s3.upload(uploadParams).promise();
    console.log('Upload successful:', response.Location);
    return response;
  } catch (error) {
    console.error('Upload failed:', error);
    throw error;
  }
}
```

This code demonstrates the complete flow. The user signs in with Google, receiving an ID token. Your app immediately exchanges that token for temporary AWS credentials by calling STS AssumeRoleWithWebIdentity. Those credentials are then used to upload directly to S3. At no point are long-term credentials stored in the app.

### Implementing with Cognito Identity Pools

If you're using Cognito Identity Pools, the implementation is even simpler because the AWS SDK handles much of the heavy lifting:

```javascript
import { CognitoIdentityClient } from '@aws-sdk/client-cognito-identity';
import { fromCognitoIdentity } from '@aws-sdk/credential-providers';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

GoogleSignin.configure({
  webClientId: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
});

async function uploadPhotoWithCognito(photoUri) {
  try {
    // Sign in with Google
    const userInfo = await GoogleSignin.signIn();
    const idToken = userInfo.idToken;

    // Create Cognito Identity client
    const cognitoIdentity = new CognitoIdentityClient({
      region: 'us-east-1',
    });

    // Get identity ID from the Cognito Identity Pool
    const identityId = await cognitoIdentity.send(
      new GetIdCommand({
        IdentityPoolId: 'YOUR_IDENTITY_POOL_ID',
        Logins: {
          'accounts.google.com': idToken,
        },
      })
    );

    // Create credentials provider
    const credentialsProvider = fromCognitoIdentity({
      client: cognitoIdentity,
      identityId: identityId.IdentityId,
      logins: {
        'accounts.google.com': idToken,
      },
    });

    // Create S3 client with temporary credentials
    const s3Client = new S3Client({
      region: 'us-east-1',
      credentials: credentialsProvider,
    });

    // Upload photo
    const photoData = await readFile(photoUri);
    const uploadCommand = new PutObjectCommand({
      Bucket: 'your-photo-bucket',
      Key: `uploads/${identityId.IdentityId}/${Date.now()}.jpg`,
      Body: photoData,
      ContentType: 'image/jpeg',
    });

    const response = await s3Client.send(uploadCommand);
    console.log('Upload successful');
    return response;
  } catch (error) {
    console.error('Upload failed:', error);
    throw error;
  }
}
```

With Cognito Identity Pools, the SDK handles credential caching and refresh automatically. You don't explicitly manage token expiration or credential rotation—the SDK abstracts this away.

### Best Practices and Security Considerations

When using AssumeRoleWithWebIdentity, several practices will help you build secure, maintainable systems.

**Always use HTTPS** when your app communicates with identity providers and AWS. Never send tokens over unencrypted connections. In mobile apps, this means validating SSL certificates properly and avoiding certificate pinning pitfalls that can break updates.

**Validate tokens on your backend** if your app calls backend services. Even though AssumeRoleWithWebIdentity validates tokens, if your backend also receives the token (say, in a request header), it should verify the token independently. Use the identity provider's public keys to validate token signatures.

**Implement credential caching intelligently**. Calling STS for every operation is inefficient. Most AWS SDKs cache credentials in memory and refresh them as they approach expiration. However, be cautious about caching across app restarts—if the user signs out, clear cached credentials immediately.

**Use scoped roles and policies** to limit blast radius. Don't create a single role with broad permissions that all users assume. Instead, use policy variables like ${aws:userid} to scope access per user. A compromised token then grants access only to that specific user's resources, not the entire bucket or table.

**Rotate identity provider credentials separately from AWS credentials**. The identity provider's credentials (your Google Client ID and secret, for example) are long-lived and powerful. Store them securely on your backend if needed, never in the mobile or web app. Rotate them regularly.

**Monitor and log AssumeRoleWithWebIdentity calls**. Enable CloudTrail to log all STS API calls. Set up CloudWatch alarms for unusual patterns—an explosion of AssumeRoleWithWebIdentity calls from unexpected sources could indicate compromised credentials or a misconfiguration.

**Test credential expiration scenarios**. In development, forcefully expire credentials and verify your app handles the refresh gracefully. This ensures your error handling works as expected in production.

### When to Use AssumeRoleWithWebIdentity Over Backend Proxies

A common architectural question is whether to use AssumeRoleWithWebIdentity for direct AWS access or to proxy AWS calls through a backend service. Both approaches have merit, and the choice depends on your specific constraints.

Direct access via AssumeRoleWithWebIdentity is ideal when users need real-time responsiveness, your backend would become a bottleneck, or you want to minimize backend load. Photo uploads, real-time data syncing, and session-based DynamoDB access are good candidates. The user gets instant feedback, and your backend is freed for business logic.

Backend proxies are better when you need tight control over what users access, complex authorization rules that involve cross-user data, or audit trails that tie operations to business contexts. For example, if users should only see reports generated within their organization, a backend proxy enforces that rule before data reaches the client. Similarly, financial transactions often require audit trails that link actions to specific business context; proxying through a backend captures this naturally.

Many modern applications use both. Direct access handles high-volume, low-latency operations. Backend proxies handle sensitive operations and business logic. This hybrid approach balances performance, security, and maintainability.

### Common Pitfalls and How to Avoid Them

Several mistakes appear frequently in implementations using AssumeRoleWithWebIdentity.

**Storing credentials in local storage or SharedPreferences** is tempting because it reduces the number of sign-in flows. Resist this. Persistent storage of AWS credentials is a major security risk. Always derive credentials at runtime from identity tokens, and let them exist only in memory.

**Forgetting to handle expired credentials** is another trap. Your app must gracefully detect when temporary credentials expire, refresh them silently if possible, or prompt the user to re-authenticate if necessary. Build retry logic and refresh token handling from the start, not as an afterthought.

**Using overly broad IAM policies** defeats the purpose of short-lived credentials. If your temporary credentials grant access to all S3 buckets or all DynamoDB tables, you've surrendered the security benefit of temporary, scoped access. Always apply least privilege.

**Mixing authentication and authorization confuses many developers**. AssumeRoleWithWebIdentity handles authentication—verifying who the user is via the identity token. IAM policies handle authorization—defining what that user can do. Both are necessary; neither is sufficient alone.

**Ignoring CORS and preflight requests** in web apps can lead to frustrated debugging. If your JavaScript SPA calls AssumeRoleWithWebIdentity directly, ensure STS is configured to accept requests from your domain. Use appropriate CORS headers and test thoroughly.

### Conclusion

AssumeRoleWithWebIdentity is a powerful, elegant solution to a fundamental challenge in modern application development: granting users secure, direct access to AWS resources without embedding long-term credentials. By exchanging identity tokens for temporary AWS credentials, you align your security model with AWS best practices, enable automatic credential rotation, and simplify your architecture.

Whether you choose the direct STS approach or the Cognito Identity Pools abstraction, the underlying principle is the same. Design your application to be stateless with respect to credentials, validate everything, scope permissions narrowly, and monitor what you've built. This approach scales from simple hobby projects to enterprise systems serving millions of users.

The next step is to implement these patterns in your own application, test the credential refresh flows thoroughly, and measure the impact on your backend load and user experience. Start with a single operation—perhaps file uploads—and expand from there. You'll find that once you've built this federation flow correctly, it becomes a reliable, maintainable part of your architecture, freeing you to focus on the features that matter.
