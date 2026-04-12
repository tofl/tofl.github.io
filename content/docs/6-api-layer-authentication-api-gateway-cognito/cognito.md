---
title: "18. Cognito"
type: docs
weight: 2
---

## Cognito

Managing user authentication from scratch is a significant engineering effort: you need to handle password hashing, account recovery, MFA, token issuance, session management, and more. Amazon Cognito [🔗](https://docs.aws.amazon.com/cognito/latest/developerguide/what-is-amazon-cognito.html) solves this by providing a fully managed identity service that handles user sign-up, sign-in, and access control so you can focus on your application logic instead of reinventing auth infrastructure.

Cognito has two distinct building blocks that are often used together but serve fundamentally different purposes: **User Pools** and **Identity Pools**.

### User Pools

A User Pool [🔗](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-identity-pools.html) is a managed user directory. It handles everything related to *authenticating* your users: registration, login, password policies, account verification, MFA, and token issuance. Think of it as your application's dedicated identity provider.

When a user signs in successfully, Cognito issues three JWT tokens:

- **ID token** — contains claims about the user's identity (name, email, custom attributes). This is what your backend uses to know *who* the user is.
- **Access token** — grants access to APIs and protected resources. It encodes the user's scopes and groups but not their profile data.
- **Refresh token** — long-lived token used to obtain new ID and access tokens without requiring the user to sign in again.

All three are standard JWTs [🔗](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-with-identity-providers.html) and can be verified locally using Cognito's public keys, which means your backend never needs to call Cognito on every request.

**Hosted UI** — Cognito provides a pre-built, customizable sign-in/sign-up UI [🔗](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-app-integration.html) that you can use out of the box via OAuth 2.0 redirect flows. This is the fastest path to a working auth UI without writing any frontend auth code.

#### User Pool Triggers

You can attach Lambda functions to lifecycle events in the User Pool to customize the authentication flow. These Lambda triggers [🔗](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-identity-pools-working-with-aws-lambda-triggers.html) run synchronously as part of the Cognito flow. The most commonly used ones are:

- **Pre sign-up** — runs before a new user is confirmed. Use it to auto-confirm users, validate email domains, or reject registrations that don't meet business rules.
- **Pre authentication** — runs before Cognito authenticates the user. Useful for blocking specific users or enforcing custom logic before credentials are checked.
- **Post authentication** — runs after a successful sign-in. A good place to log auth events or sync user data to your own database.
- **Post confirmation** — runs after a user confirms their account. Often used to create the user's profile record in DynamoDB or send a welcome email.

A practical example: if you want to allow sign-up only for users with a corporate email domain (`@yourcompany.com`), you implement a pre sign-up trigger that inspects the email attribute and raises an exception to block any other domain.

### Identity Pools (Federated Identities)

While User Pools handle *who the user is*, Identity Pools [🔗](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-identity.html) handle *what the user can do with AWS*. An Identity Pool exchanges a validated identity token (from a User Pool, a social provider, or another IdP) for temporary AWS credentials via STS [🔗](https://docs.aws.amazon.com/STS/latest/APIReference/welcome.html).

This is what enables patterns like: a mobile app user uploads a file directly to S3, or queries a DynamoDB table, without your backend acting as a proxy. The credentials are scoped to an IAM role you define, so you control exactly which AWS actions are permitted.

Identity Pools support both *authenticated* identities (users who have signed in) and *unauthenticated* identities (guest users), with separate IAM roles for each.

### User Pools vs Identity Pools

This distinction trips up many developers, so it's worth stating clearly:

| | User Pool | Identity Pool |
|---|---|---|
| **Purpose** | Authentication — verify who the user is | Authorization — grant temporary AWS credentials |
| **Output** | JWT tokens (ID, Access, Refresh) | STS temporary credentials (Access Key, Secret, Session Token) |
| **Use when** | You need login/signup for your app | You need users to call AWS services directly |

In most real-world applications, both are used together: the User Pool authenticates the user and issues a JWT, and the Identity Pool exchanges that JWT for AWS credentials the client can use to access S3, DynamoDB, etc. directly.

### Social Providers and Federation

Cognito User Pools support federation with external identity providers [🔗](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-identity-federation.html), meaning users can sign in with existing accounts rather than creating a new one. Supported options include:

- **Social providers** — Google, Facebook, Apple, and Amazon via OAuth 2.0.
- **SAML 2.0** — for enterprise SSO integration (e.g., Okta, Active Directory Federation Services).
- **OIDC providers** — any OpenID Connect-compliant identity provider.

From your application's perspective, federated logins produce the same JWT tokens as native Cognito logins — the underlying provider is abstracted away.

### Integrating Cognito with API Gateway

The most common backend integration pattern is using a **Cognito User Pool authorizer** in API Gateway [🔗](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-integrate-with-cognito.html). The flow works as follows:

1. The client authenticates with Cognito and receives an ID or access token.
2. The client includes the token in the `Authorization` header of every API request.
3. API Gateway validates the JWT signature against Cognito's public keys — no Lambda function needed, no custom code.
4. If the token is valid and not expired, the request proceeds to the backend integration. If not, API Gateway returns a `401 Unauthorized` immediately.

This is significantly simpler than a Lambda authorizer for straightforward auth scenarios, because Cognito handles the entire token lifecycle and API Gateway handles validation natively.

### ALB + Cognito Authentication

Application Load Balancer (ALB) can also integrate directly with Cognito [🔗](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/listener-authenticate-users.html) to protect applications running on EC2, ECS, or any HTTP backend. When this is configured, the ALB itself handles the OAuth 2.0 redirect flow: unauthenticated users are redirected to the Cognito Hosted UI, and after login, the ALB forwards the request to your backend with user claims injected as HTTP headers. Your application receives pre-authenticated requests without needing to implement any auth logic itself.

{{< qcm >}}
[
{
"question": "A user successfully signs in to an Amazon Cognito User Pool. Which tokens are issued by Cognito upon successful authentication?",
"answers": [
{
"answer": "ID token",
"isCorrect": true,
"explanation": "The ID token is issued upon successful authentication and contains claims about the user's identity such as name, email, and custom attributes."
},
{
"answer": "Access token",
"isCorrect": true,
"explanation": "The access token is issued upon successful authentication and is used to grant access to APIs and protected resources, encoding the user's scopes and groups."
},
{
"answer": "Refresh token",
"isCorrect": true,
"explanation": "The refresh token is a long-lived token issued upon successful authentication, used to obtain new ID and access tokens without requiring the user to sign in again."
},
{
"answer": "STS session token",
"isCorrect": false,
"explanation": "STS session tokens (temporary AWS credentials) are issued by Cognito Identity Pools, not User Pools. User Pools issue JWT tokens only."
}
]
},
{
"question": "A developer wants their backend to identify who the authenticated user is after a Cognito sign-in. Which token should the backend use?",
"answers": [
{
"answer": "ID token",
"isCorrect": true,
"explanation": "The ID token contains identity claims about the user (name, email, custom attributes) and is specifically designed for the backend to know who the user is."
},
{
"answer": "Access token",
"isCorrect": false,
"explanation": "The access token grants access to APIs and encodes scopes/groups, but does not contain user profile data. It is not the right token for identifying who the user is."
},
{
"answer": "Refresh token",
"isCorrect": false,
"explanation": "The refresh token is used solely to obtain new ID and access tokens. It contains no identity claims and should not be used to identify the user."
},
{
"answer": "STS temporary credentials",
"isCorrect": false,
"explanation": "STS temporary credentials are AWS credentials for calling AWS services. They are not used for user identity claims in backend logic."
}
]
},
{
"question": "A company wants to allow only users with a @company.com email domain to register in their Cognito User Pool. What is the most appropriate way to implement this?",
"answers": [
{
"answer": "Use a Pre sign-up Lambda trigger to inspect the email attribute and raise an exception for non-company domains.",
"isCorrect": true,
"explanation": "The Pre sign-up trigger runs before a new user is confirmed and is the correct place to validate email domains and reject registrations that don't meet business rules."
},
{
"answer": "Use a Post confirmation Lambda trigger to delete accounts with non-company domains.",
"isCorrect": false,
"explanation": "The Post confirmation trigger runs after the user has already confirmed their account. Blocking registrations at this stage is too late and provides a poor user experience."
},
{
"answer": "Use a Pre authentication Lambda trigger to block non-company domain users.",
"isCorrect": false,
"explanation": "The Pre authentication trigger runs before credentials are checked at sign-in, not during registration. It cannot prevent users from registering in the first place."
},
{
"answer": "Configure an IAM policy on the User Pool to filter email domains.",
"isCorrect": false,
"explanation": "IAM policies cannot filter users by email domain during registration. Lambda triggers are the correct mechanism for this type of custom registration logic."
}
]
},
{
"question": "A mobile application needs to allow authenticated users to upload files directly to an Amazon S3 bucket without routing requests through a backend server. Which Cognito feature enables this?",
"answers": [
{
"answer": "Cognito Identity Pool",
"isCorrect": true,
"explanation": "Identity Pools exchange a validated identity token (from a User Pool or other IdP) for temporary AWS credentials via STS, scoped to an IAM role. This allows clients to call AWS services like S3 directly."
},
{
"answer": "Cognito User Pool",
"isCorrect": false,
"explanation": "User Pools handle authentication and issue JWT tokens, but do not provide AWS credentials. You cannot use a User Pool JWT to call AWS services like S3 directly."
},
{
"answer": "Cognito Hosted UI",
"isCorrect": false,
"explanation": "The Hosted UI is a pre-built sign-in/sign-up interface. It does not grant AWS credentials or enable direct S3 access."
},
{
"answer": "Cognito User Pool with an access token",
"isCorrect": false,
"explanation": "Access tokens from User Pools are JWTs for API access, not AWS credentials. They cannot be used to directly call AWS services such as S3 or DynamoDB."
}
]
},
{
"question": "What does Amazon Cognito Identity Pool issue when a user's identity is successfully validated?",
"answers": [
{
"answer": "Temporary AWS credentials (Access Key, Secret Key, Session Token) via STS",
"isCorrect": true,
"explanation": "Identity Pools exchange a validated identity token for temporary AWS credentials issued by STS, scoped to an IAM role defined by the developer."
},
{
"answer": "JWT tokens (ID, Access, Refresh)",
"isCorrect": false,
"explanation": "JWT tokens are issued by Cognito User Pools, not Identity Pools. Identity Pools issue temporary STS credentials, not JWTs."
},
{
"answer": "A long-lived IAM access key",
"isCorrect": false,
"explanation": "Identity Pools issue temporary, short-lived credentials via STS — never long-lived IAM access keys, which would be a security risk."
},
{
"answer": "An OAuth 2.0 authorization code",
"isCorrect": false,
"explanation": "OAuth 2.0 authorization codes are part of the Hosted UI flow in User Pools. Identity Pools issue STS credentials, not authorization codes."
}
]
},
{
"question": "A developer is setting up API Gateway to authenticate requests using Amazon Cognito. Which statement best describes how this integration works?",
"answers": [
{
"answer": "The client includes a Cognito JWT in the Authorization header; API Gateway validates the token against Cognito's public keys without invoking a Lambda function.",
"isCorrect": true,
"explanation": "API Gateway's Cognito User Pool authorizer natively validates JWT signatures using Cognito's public keys, requiring no custom Lambda code and returning 401 if the token is invalid or expired."
},
{
"answer": "A Lambda authorizer must be created to call Cognito and validate the token on every request.",
"isCorrect": false,
"explanation": "A Lambda authorizer is not required for Cognito integration. API Gateway's built-in Cognito User Pool authorizer handles token validation natively, which is simpler for standard auth scenarios."
},
{
"answer": "The client sends credentials to API Gateway, which forwards them to Cognito and retrieves a token on behalf of the user.",
"isCorrect": false,
"explanation": "The client is responsible for authenticating with Cognito and obtaining a token itself. API Gateway only validates the token — it does not perform authentication on behalf of clients."
},
{
"answer": "API Gateway stores Cognito tokens in a cache and validates them periodically.",
"isCorrect": false,
"explanation": "API Gateway validates the JWT on each request using Cognito's public keys. It does not store tokens in a cache and validate them periodically."
}
]
},
{
"question": "Which of the following identity providers can be federated with an Amazon Cognito User Pool? (Select THREE)",
"answers": [
{
"answer": "Google via OAuth 2.0",
"isCorrect": true,
"explanation": "Cognito User Pools support federation with Google as a social identity provider via OAuth 2.0."
},
{
"answer": "Enterprise SSO via SAML 2.0 (e.g., Okta)",
"isCorrect": true,
"explanation": "Cognito User Pools support SAML 2.0 federation, enabling integration with enterprise identity providers such as Okta or Active Directory Federation Services."
},
{
"answer": "Any OpenID Connect (OIDC)-compliant provider",
"isCorrect": true,
"explanation": "Cognito User Pools support federation with any OIDC-compliant identity provider, offering broad compatibility beyond the built-in social providers."
},
{
"answer": "AWS IAM users and roles directly",
"isCorrect": false,
"explanation": "IAM users and roles are not federated into Cognito User Pools. IAM is a separate AWS access management system; federated identity for AWS credentials is the role of Identity Pools."
}
]
},
{
"question": "What is the purpose of the Post confirmation Lambda trigger in a Cognito User Pool?",
"answers": [
{
"answer": "It runs after a user confirms their account, and is commonly used to create a user profile in DynamoDB or send a welcome email.",
"isCorrect": true,
"explanation": "The Post confirmation trigger fires after account confirmation is complete, making it the right place to initialize user data in a database or trigger a welcome notification."
},
{
"answer": "It runs before a new user is registered to validate their email domain.",
"isCorrect": false,
"explanation": "This describes the Pre sign-up trigger, which runs before user confirmation. The Post confirmation trigger runs after the account is already confirmed."
},
{
"answer": "It runs after a successful sign-in to log authentication events.",
"isCorrect": false,
"explanation": "This describes the Post authentication trigger, not Post confirmation. Post confirmation is specifically tied to the account confirmation step, not to every subsequent sign-in."
},
{
"answer": "It runs before credentials are checked to block specific users.",
"isCorrect": false,
"explanation": "This describes the Pre authentication trigger. Post confirmation runs after account confirmation and is not involved in blocking users during sign-in."
}
]
},
{
"question": "A team wants to protect a web application running on EC2 instances behind an Application Load Balancer (ALB). They want unauthenticated users to be redirected to the Cognito Hosted UI automatically, without implementing any auth logic in the application. Is this possible, and how?",
"answers": [
{
"answer": "Yes. ALB can integrate directly with Cognito, handling the OAuth 2.0 redirect flow and injecting user claims as HTTP headers into requests forwarded to the backend.",
"isCorrect": true,
"explanation": "ALB supports native Cognito integration. It redirects unauthenticated users to the Cognito Hosted UI, and after login forwards requests to the backend with user identity claims in HTTP headers — no auth code needed in the application."
},
{
"answer": "No. Authentication must always be handled at the application level; ALB only does TLS termination.",
"isCorrect": false,
"explanation": "ALB can do much more than TLS termination. It supports native authentication integration with Cognito, enabling it to handle the entire auth redirect flow transparently."
},
{
"answer": "Yes, but only if the application is running on AWS Lambda, not EC2 or ECS.",
"isCorrect": false,
"explanation": "ALB + Cognito authentication works with any HTTP backend including EC2, ECS, and on-premises servers. It is not limited to Lambda."
},
{
"answer": "Yes, but the application must still validate the Cognito JWT on every request received from the ALB.",
"isCorrect": false,
"explanation": "When ALB handles Cognito authentication, it forwards pre-authenticated requests with user claims as HTTP headers. The application does not need to validate JWTs itself."
}
]
},
{
"question": "A developer's backend needs to verify Cognito JWT tokens on every incoming API request. What is the most efficient approach?",
"answers": [
{
"answer": "Verify the JWT locally using Cognito's public keys, without calling Cognito on every request.",
"isCorrect": true,
"explanation": "Cognito JWTs can be verified locally using Cognito's published public keys. This avoids a network call to Cognito on every request, making token validation fast and scalable."
},
{
"answer": "Call the Cognito API on every request to validate the token.",
"isCorrect": false,
"explanation": "Calling Cognito on every request is unnecessary and introduces latency and cost. JWTs are self-contained and can be verified locally using Cognito's public keys."
},
{
"answer": "Store validated tokens in a DynamoDB table and look them up on each request.",
"isCorrect": false,
"explanation": "Storing and looking up tokens in DynamoDB adds unnecessary complexity and latency. Local JWT verification using public keys is the standard and recommended approach."
},
{
"answer": "Use the refresh token to re-authenticate the user on every request.",
"isCorrect": false,
"explanation": "Refresh tokens are used to obtain new tokens when the current ones expire, not to validate tokens on every request. This approach would be extremely inefficient and incorrect."
}
]
},
{
"question": "Which Cognito component is responsible for authenticating users and issuing JWT tokens?",
"answers": [
{
"answer": "Cognito User Pool",
"isCorrect": true,
"explanation": "User Pools are managed user directories that handle authentication — registration, login, MFA, password policies — and issue JWT tokens (ID, Access, Refresh) upon successful sign-in."
},
{
"answer": "Cognito Identity Pool",
"isCorrect": false,
"explanation": "Identity Pools handle authorization by exchanging validated identity tokens for temporary AWS credentials. They do not authenticate users or issue JWTs."
},
{
"answer": "AWS STS",
"isCorrect": false,
"explanation": "STS (Security Token Service) issues temporary AWS credentials, but it is invoked by Identity Pools — not directly responsible for user authentication or JWT issuance."
},
{
"answer": "AWS IAM",
"isCorrect": false,
"explanation": "IAM manages AWS resource access policies and roles. It does not handle user authentication or issue JWT tokens for application users."
}
]
},
{
"question": "An application uses Cognito User Pools for authentication and Cognito Identity Pools for AWS resource access. In what order do these services typically interact in a standard flow?",
"answers": [
{
"answer": "The User Pool authenticates the user and issues a JWT; the Identity Pool exchanges the JWT for temporary AWS credentials via STS.",
"isCorrect": true,
"explanation": "This is the standard combined flow: User Pool handles authentication and issues JWTs, then the Identity Pool takes the JWT and exchanges it with STS for scoped temporary AWS credentials."
},
{
"answer": "The Identity Pool authenticates the user first, then the User Pool issues a JWT.",
"isCorrect": false,
"explanation": "The order is reversed. User Pools handle authentication first. Identity Pools consume an already-validated identity token to issue AWS credentials."
},
{
"answer": "STS authenticates the user directly, then the User Pool issues a JWT.",
"isCorrect": false,
"explanation": "STS does not authenticate application users. It is a downstream service called by Identity Pools to issue temporary credentials after identity has been established by a User Pool or other IdP."
},
{
"answer": "The Identity Pool issues a JWT, which the User Pool validates before granting access.",
"isCorrect": false,
"explanation": "Identity Pools do not issue JWTs. They issue temporary STS credentials. JWTs are issued by User Pools, not Identity Pools."
}
]
},
{
"question": "A Cognito User Pool is configured with a Pre authentication Lambda trigger. When exactly does this trigger run?",
"answers": [
{
"answer": "Before Cognito authenticates the user's credentials, allowing custom logic to block or modify the authentication flow.",
"isCorrect": true,
"explanation": "The Pre authentication trigger fires before Cognito checks credentials. It's useful for blocking specific users or enforcing custom business rules before authentication proceeds."
},
{
"answer": "After the user successfully signs in, allowing post-login processing.",
"isCorrect": false,
"explanation": "This describes the Post authentication trigger. Pre authentication runs before credentials are checked, not after a successful sign-in."
},
{
"answer": "Before a new user submits their registration form.",
"isCorrect": false,
"explanation": "This describes the Pre sign-up trigger. Pre authentication applies to sign-in flows, not to new user registration."
},
{
"answer": "After a user confirms their email address.",
"isCorrect": false,
"explanation": "This describes the Post confirmation trigger. Pre authentication is unrelated to email confirmation and fires during the sign-in process."
}
]
},
{
"question": "Which of the following statements correctly describes the difference between a Cognito User Pool and a Cognito Identity Pool?",
"answers": [
{
"answer": "A User Pool handles authentication and issues JWT tokens; an Identity Pool handles authorization and issues temporary AWS credentials.",
"isCorrect": true,
"explanation": "This is the core distinction: User Pools = authentication (who the user is, JWT tokens); Identity Pools = authorization (what the user can do with AWS, STS credentials)."
},
{
"answer": "A User Pool issues temporary AWS credentials; an Identity Pool issues JWT tokens.",
"isCorrect": false,
"explanation": "This is the reverse of the correct behavior. User Pools issue JWTs; Identity Pools issue temporary AWS credentials via STS."
},
{
"answer": "Both User Pools and Identity Pools issue JWT tokens but for different purposes.",
"isCorrect": false,
"explanation": "Only User Pools issue JWT tokens. Identity Pools issue temporary STS credentials, not JWTs."
},
{
"answer": "User Pools and Identity Pools are interchangeable; they provide the same functionality.",
"isCorrect": false,
"explanation": "User Pools and Identity Pools serve fundamentally different purposes and are not interchangeable. They are often used together but solve distinct problems."
}
]
},
{
"question": "A company uses Cognito with an application load balancer. After ALB authenticates users via Cognito, how does the backend application receive user identity information?",
"answers": [
{
"answer": "User claims are injected as HTTP headers into the request forwarded by the ALB to the backend.",
"isCorrect": true,
"explanation": "After ALB handles the Cognito authentication flow, it forwards the request to the backend with user identity claims embedded as HTTP headers. The application can read these headers directly."
},
{
"answer": "The backend must call Cognito directly with the session ID to retrieve user claims.",
"isCorrect": false,
"explanation": "The ALB handles the authentication and injects claims into headers. The backend does not need to call Cognito itself when using ALB + Cognito integration."
},
{
"answer": "The JWT token is attached to the request body for the backend to parse.",
"isCorrect": false,
"explanation": "The ALB injects user claims as HTTP headers, not into the request body. The backend reads headers, not the raw JWT."
},
{
"answer": "The backend receives a temporary STS credential from the ALB to identify the user.",
"isCorrect": false,
"explanation": "STS credentials are for AWS resource access, not for passing user identity to a backend application. The ALB uses HTTP headers with user claims for this purpose."
}
]
}
]
{{< /qcm >}}