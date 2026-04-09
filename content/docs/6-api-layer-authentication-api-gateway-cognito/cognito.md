---
title: "18. Cognito"
type: docs
weight: 2
---

# Cognito

Managing user authentication from scratch is a significant engineering effort: you need to handle password hashing, account recovery, MFA, token issuance, session management, and more. Amazon Cognito [🔗](https://docs.aws.amazon.com/cognito/latest/developerguide/what-is-amazon-cognito.html) solves this by providing a fully managed identity service that handles user sign-up, sign-in, and access control so you can focus on your application logic instead of reinventing auth infrastructure.

Cognito has two distinct building blocks that are often used together but serve fundamentally different purposes: **User Pools** and **Identity Pools**.

## User Pools

A User Pool [🔗](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-identity-pools.html) is a managed user directory. It handles everything related to *authenticating* your users: registration, login, password policies, account verification, MFA, and token issuance. Think of it as your application's dedicated identity provider.

When a user signs in successfully, Cognito issues three JWT tokens:

- **ID token** — contains claims about the user's identity (name, email, custom attributes). This is what your backend uses to know *who* the user is.
- **Access token** — grants access to APIs and protected resources. It encodes the user's scopes and groups but not their profile data.
- **Refresh token** — long-lived token used to obtain new ID and access tokens without requiring the user to sign in again.

All three are standard JWTs [🔗](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-with-identity-providers.html) and can be verified locally using Cognito's public keys, which means your backend never needs to call Cognito on every request.

**Hosted UI** — Cognito provides a pre-built, customizable sign-in/sign-up UI [🔗](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-app-integration.html) that you can use out of the box via OAuth 2.0 redirect flows. This is the fastest path to a working auth UI without writing any frontend auth code.

### User Pool Triggers

You can attach Lambda functions to lifecycle events in the User Pool to customize the authentication flow. These Lambda triggers [🔗](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-identity-pools-working-with-aws-lambda-triggers.html) run synchronously as part of the Cognito flow. The most commonly used ones are:

- **Pre sign-up** — runs before a new user is confirmed. Use it to auto-confirm users, validate email domains, or reject registrations that don't meet business rules.
- **Pre authentication** — runs before Cognito authenticates the user. Useful for blocking specific users or enforcing custom logic before credentials are checked.
- **Post authentication** — runs after a successful sign-in. A good place to log auth events or sync user data to your own database.
- **Post confirmation** — runs after a user confirms their account. Often used to create the user's profile record in DynamoDB or send a welcome email.

A practical example: if you want to allow sign-up only for users with a corporate email domain (`@yourcompany.com`), you implement a pre sign-up trigger that inspects the email attribute and raises an exception to block any other domain.

## Identity Pools (Federated Identities)

While User Pools handle *who the user is*, Identity Pools [🔗](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-identity.html) handle *what the user can do with AWS*. An Identity Pool exchanges a validated identity token (from a User Pool, a social provider, or another IdP) for temporary AWS credentials via STS [🔗](https://docs.aws.amazon.com/STS/latest/APIReference/welcome.html).

This is what enables patterns like: a mobile app user uploads a file directly to S3, or queries a DynamoDB table, without your backend acting as a proxy. The credentials are scoped to an IAM role you define, so you control exactly which AWS actions are permitted.

Identity Pools support both *authenticated* identities (users who have signed in) and *unauthenticated* identities (guest users), with separate IAM roles for each.

## User Pools vs Identity Pools

This distinction trips up many developers, so it's worth stating clearly:

| | User Pool | Identity Pool |
|---|---|---|
| **Purpose** | Authentication — verify who the user is | Authorization — grant temporary AWS credentials |
| **Output** | JWT tokens (ID, Access, Refresh) | STS temporary credentials (Access Key, Secret, Session Token) |
| **Use when** | You need login/signup for your app | You need users to call AWS services directly |

In most real-world applications, both are used together: the User Pool authenticates the user and issues a JWT, and the Identity Pool exchanges that JWT for AWS credentials the client can use to access S3, DynamoDB, etc. directly.

## Social Providers and Federation

Cognito User Pools support federation with external identity providers [🔗](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-identity-federation.html), meaning users can sign in with existing accounts rather than creating a new one. Supported options include:

- **Social providers** — Google, Facebook, Apple, and Amazon via OAuth 2.0.
- **SAML 2.0** — for enterprise SSO integration (e.g., Okta, Active Directory Federation Services).
- **OIDC providers** — any OpenID Connect-compliant identity provider.

From your application's perspective, federated logins produce the same JWT tokens as native Cognito logins — the underlying provider is abstracted away.

## Integrating Cognito with API Gateway

The most common backend integration pattern is using a **Cognito User Pool authorizer** in API Gateway [🔗](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-integrate-with-cognito.html). The flow works as follows:

1. The client authenticates with Cognito and receives an ID or access token.
2. The client includes the token in the `Authorization` header of every API request.
3. API Gateway validates the JWT signature against Cognito's public keys — no Lambda function needed, no custom code.
4. If the token is valid and not expired, the request proceeds to the backend integration. If not, API Gateway returns a `401 Unauthorized` immediately.

This is significantly simpler than a Lambda authorizer for straightforward auth scenarios, because Cognito handles the entire token lifecycle and API Gateway handles validation natively.

## ALB + Cognito Authentication

Application Load Balancer (ALB) can also integrate directly with Cognito [🔗](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/listener-authenticate-users.html) to protect applications running on EC2, ECS, or any HTTP backend. When this is configured, the ALB itself handles the OAuth 2.0 redirect flow: unauthenticated users are redirected to the Cognito Hosted UI, and after login, the ALB forwards the request to your backend with user claims injected as HTTP headers. Your application receives pre-authenticated requests without needing to implement any auth logic itself.