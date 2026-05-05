---
title: "ALB Authentication with Amazon Cognito and OIDC Providers"
---

## ALB Authentication with Amazon Cognito and OIDC Providers

Authentication is one of those problems that feels simple until you actually have to build it at scale. Most developers understand the basics: verify a user's identity, issue a token, protect routes. But in a distributed cloud architecture, the question becomes: where should authentication really happen? Should you bake it into every microservice? Thread it through your application code? Or offload it entirely to your infrastructure?

Amazon Application Load Balancer (ALB) offers an elegant answer through its built-in authentication feature. By adding authentication at the load balancer level—whether through Amazon Cognito User Pools or any OIDC-compliant identity provider—you can enforce authentication before requests even reach your application targets. This article walks you through how ALB authentication works, how to configure it, and how to integrate it with providers like Google Workspace, Cognito, or any standards-compliant identity system.

### Understanding ALB Authentication at the Network Edge

ALB authentication works by intercepting requests at the load balancer before they hit your backend targets. When you configure an `authenticate-cognito` or `authenticate-oidc` action on a listener rule, the ALB becomes a guard at your application's front door. Unauthenticated users are redirected to your identity provider's login page. Once they authenticate successfully, ALB manages the session and allows subsequent requests through.

This architecture has significant advantages. Your application code never sees an unauthenticated request in the first place, which eliminates an entire class of security concerns. You also reduce the authentication burden on your backend services—they can focus on business logic while the ALB handles identity verification. For teams running multiple microservices, this means you don't need to implement authentication logic in each one.

The flow works like this: a user requests a protected resource, ALB checks for a valid session, and if none exists, redirects to your identity provider's authorization endpoint. After successful authentication, the identity provider redirects back to ALB with authorization credentials. ALB exchanges these for tokens, sets a session cookie in the user's browser, and forwards the request onward. On subsequent requests, ALB validates the session cookie without requiring another trip to the identity provider.

### Choosing Between Cognito and Generic OIDC Providers

Before diving into configuration, you need to decide which identity provider fits your use case. Amazon Cognito User Pools is a purpose-built service for managing user authentication and identity. It handles user registration, password resets, multi-factor authentication, and user attribute management. If you're building a customer-facing application where you need to manage the entire user lifecycle, Cognito is usually the right choice.

Generic OIDC providers, on the other hand, represent any identity system that implements the OpenID Connect standard. This includes enterprise solutions like Okta, Auth0, and importantly for many organizations, identity systems you already own—such as Google Workspace, Azure AD, or a self-hosted Keycloak instance. If your users already have identities managed elsewhere, federating through OIDC means users log in with credentials they already know, and you don't have to synchronize user data.

The technical difference is minimal from ALB's perspective. Both require you to register your application as a client in the identity provider, obtain client credentials, and configure ALB with those credentials. The OIDC flow itself is nearly identical. The real difference is operational: Cognito gives you user management built into AWS, while OIDC gives you flexibility to use whatever identity system you prefer.

### Configuring ALB with Cognito Authentication

Let's walk through a concrete example: protecting an internal application with Cognito authentication. We'll assume you already have a Cognito User Pool created with some users populated.

First, register your ALB as a client application in Cognito. Navigate to your User Pool, go to App Clients, and create a new one. You'll need to set the callback URL to your ALB's domain name or hostname, formatted like this:

```
https://myapp.example.com/oauth2/idpresponse
```

This callback URL is critical—it's where Cognito redirects users after they authenticate. Cognito will provide you with a Client ID and Client Secret. Keep these secure; they're your application's credentials.

Next, in the ALB listener rules, add an authenticate-cognito action. Here's the structure of what you're configuring:

```
Type: authenticate-cognito
UserPoolArn: arn:aws:cognito-idp:region:account-id:userpool/region_poolid
UserPoolClientId: your-client-id
UserPoolDomain: your-domain.auth.region.amazoncognito.com
OnUnauthenticatedRequest: authenticate
SessionCookieName: AWSELBAuthSessionCookie
SessionTimeout: 604800
```

The `OnUnauthenticatedRequest` parameter controls what happens when an unauthenticated user arrives. Setting it to `authenticate` redirects them to the login page. Alternatively, you can set it to `deny`, which returns an HTTP 401 response instead.

The `SessionCookieName` defaults to `AWSELBAuthSessionCookie`, but you can customize it if needed. The `SessionTimeout` determines how long the session lasts before requiring re-authentication, measured in seconds. A week (604800 seconds) is reasonable for internal tools; you might choose shorter timeouts for higher-security applications.

### Integrating with OIDC Providers: Google Workspace Example

Many organizations use Google Workspace for email and identity. Protecting an internal application with Google Workspace SSO is a common requirement. The setup is similar to Cognito but with some Google-specific configuration.

First, you need to register your ALB as an authorized application in Google Cloud Console. Create an OAuth 2.0 credential of type "Web application," and add your ALB's callback URL:

```
https://myapp.example.com/oauth2/idpresponse
```

Google will provide you with a Client ID and Client Secret. You'll also need your Google Workspace domain's OpenID Connect metadata endpoint, which by default is:

```
https://accounts.google.com/.well-known/openid-configuration
```

Now configure the ALB's authenticate-oidc action:

```
Type: authenticate-oidc
Issuer: https://accounts.google.com
AuthorizationEndpoint: https://accounts.google.com/o/oauth2/v2/auth
TokenEndpoint: https://oauth2.googleapis.com/token
UserInfoEndpoint: https://openidconnect.googleapis.com/v1/userinfo
ClientId: your-client-id.apps.googleusercontent.com
ClientSecret: your-client-secret
OnUnauthenticatedRequest: authenticate
SessionCookieName: AWSELBAuthSessionCookie
SessionTimeout: 604800
Scope: "openid email profile"
```

The `Scope` parameter defines what user information Google will provide. `openid` is required; `email` and `profile` are commonly included so your application knows who the user is.

Once configured, any request to your ALB will trigger a redirect to Google's login page if the user isn't already authenticated. After login, Google redirects back to the ALB's callback endpoint, which validates the response and sets a session cookie. Subsequent requests include that cookie, allowing the ALB to grant access without another round-trip to Google.

### Session Management and Headers

Understanding how ALB manages sessions is important for debugging and for knowing what information reaches your backend. The primary mechanism is the session cookie, `AWSELBAuthSessionCookie` by default. This cookie is encrypted and contains session data that ALB verifies on each request. If the cookie is missing, expired, or tampered with, ALB treats the request as unauthenticated.

When a request passes authentication, ALB forwards it to your backend with additional headers containing OIDC claim information. These headers begin with `X-Amzn-Oidc-` and include key user attributes:

- `X-Amzn-Oidc-Identity`: The unique user identifier from your identity provider
- `X-Amzn-Oidc-Accesstoken`: The access token returned by the identity provider
- `X-Amzn-Oidc-Data`: Contains additional OIDC claims about the user

Your application can read these headers to understand who the current user is without having to parse tokens or make additional calls to the identity provider. For example, a Node.js application might access the user identity like this:

```javascript
const userId = req.headers['x-amzn-oidc-identity'];
const accessToken = req.headers['x-amzn-oidc-accesstoken'];
console.log(`Authenticated as: ${userId}`);
```

This design keeps your application simple. You don't need JWT parsing libraries or token validation logic. ALB has already verified the user's identity and passes you the verified claims.

### Implementing Sign-Out Flows

Authentication without a good sign-out mechanism is incomplete. When a user clicks "Logout," you need to clear their session and ideally redirect them to your identity provider's logout endpoint to end their session there too.

The session cookie approach makes sign-out straightforward from an ALB perspective. You can create a listener rule that matches a sign-out path—for example, `/logout`—and sets the session cookie to an empty value or expires it immediately. This is typically done with an HTTP redirect action that clears the cookie and redirects to your home page or a goodbye page.

However, this approach only clears ALB's session; the user might still have an active session with your identity provider. For a complete sign-out experience, especially in enterprise settings, you want to also invalidate the session at the identity provider level. This requires redirecting the user to the provider's logout endpoint.

If you're using Cognito, the logout URL follows this pattern:

```
https://your-domain.auth.region.amazoncognito.com/logout?client_id=your-client-id&logout_uri=https://myapp.example.com/goodbye
```

For generic OIDC providers, consult their documentation for the logout endpoint format. Google Workspace doesn't have a standard logout endpoint in the same way, but you can redirect to `https://accounts.google.com/Logout` to clear Google's session.

Your application typically implements sign-out by redirecting to the provider's logout endpoint, which in turn redirects back to a post-logout URI you specify. ALB can't orchestrate this flow directly; it must happen within your application code.

### IAM Permissions and Security Considerations

To configure ALB authentication, the identity or role making the changes needs appropriate IAM permissions. The key permissions required are:

- `elasticloadbalancing:ModifyListener` to add or modify authentication actions
- `elasticloadbalancing:ModifyRule` to add authentication to specific rules
- For Cognito specifically, you might need `cognito-idp:DescribeUserPool` to validate the User Pool ARN

When storing client secrets in your ALB configuration, AWS encrypts them at rest. However, anyone with `elasticloadbalancing:DescribeListeners` or `elasticloadbalancing:DescribeRules` can see the secret in plaintext through the API or console. Guard these permissions carefully—typically, only infrastructure or security teams should have the ability to view or modify authentication configuration.

From a security perspective, ALB authentication handles several important concerns automatically. It enforces HTTPS for the callback URL, preventing credential interception. It validates OAuth responses using cryptographic signatures, preventing token forgery. It manages session cookies with secure flags and short expiration times, reducing the window for session hijacking.

That said, ALB authentication isn't a complete security solution. It verifies identity but doesn't enforce authorization—you still need logic in your application to determine what authenticated users can actually do. It also doesn't protect your backend if a user somehow acquires direct access to it, bypassing ALB. Design your network to ensure traffic must flow through ALB; use security groups to block direct access to application instances.

### Common Configuration Patterns and Troubleshooting

In real deployments, you'll often want to exclude certain paths from authentication. For example, you might need your health check endpoint to be accessible without authentication, or your homepage might be public while everything else requires login. ALB listener rules let you implement this: create a rule matching the public path with a forward action (no authentication), and place it *before* your authentication rule in the rule priority order.

A common source of confusion is the `OnUnauthenticatedRequest` parameter. Setting it to `authenticate` redirects to the identity provider. Setting it to `deny` returns 401. A third option, `allow`, passes the request through without authentication—this is rarely what you want, but it's useful for testing or for paths you deliberately want public.

If users report being stuck in authentication loops, check that the callback URL configured in your identity provider exactly matches what ALB expects. Trailing slashes, protocol mismatches, and domain variations all cause failures. The callback URL in your configuration should match precisely:

```
https://yourdomain.example.com/oauth2/idpresponse
```

Another frequent issue: identity provider rejections due to mismatched redirect URIs. When you configure the OIDC endpoints, ensure you're pointing to the correct authorization and token endpoints for your provider. Google, Microsoft, Okta, and Auth0 each have slightly different endpoint URLs.

If you're seeing `X-Amzn-Oidc-*` headers missing from your backend requests, verify that authentication actually succeeded. Check ALB access logs to see if requests are being redirected to the identity provider. If authentication appears to be working but headers aren't present, it might be that ALB is stripping them—though this is rare and typically only happens if explicitly configured.

### Scaling Authentication Across Multiple Applications

As your organization grows, you'll likely want to protect multiple applications with the same identity provider. This is where ALB authentication shines. You can configure different applications to authenticate with the same Cognito User Pool or OIDC provider, giving your users a consistent login experience across your infrastructure.

The key consideration is the callback URL. Each application needs a unique callback URL registered with your identity provider, and each ALB listener needs its own configuration. If you're managing dozens of applications, you might standardize on a callback URL pattern like `/oauth2/idpresponse` for all of them—this is what ALB expects by default, so keeping it consistent reduces confusion.

For organizations with multiple environments (development, staging, production), you'll need separate OAuth client configurations for each, since the callback URL differs. This adds operational overhead but is essential for security—you don't want your production client secret used in development environments.

### Monitoring and Observability

ALB access logs provide visibility into authentication flows. When ALB redirects an unauthenticated user to the identity provider, you'll see a redirect response (302) in the logs. Successful authentications result in a forward to your backend target with a 200 (or whatever your application returns). Failed authentications might show up as 401s or repeated redirects.

CloudWatch metrics don't provide deep insight into authentication specifically, but you can monitor overall request patterns. A spike in redirects might indicate an issue with your identity provider or a configuration problem. Dropped connections during the authentication flow could point to network issues or misconfigurations.

Your application logs will show the `X-Amzn-Oidc-Identity` header if you log request headers. This helps you correlate application events with user identities and is invaluable for debugging user-specific issues.

### Conclusion

ALB authentication with Cognito and OIDC providers represents a powerful way to secure web applications without baking authentication logic into your application code. By offloading identity verification to your load balancer, you simplify your application architecture, reduce the security surface area, and gain the flexibility to change identity providers without touching application code.

The configuration itself is straightforward: register your application with your identity provider, obtain credentials, and add an authenticate-cognito or authenticate-oidc action to your listener rules. ALB handles the OAuth flow, manages sessions with encrypted cookies, and passes verified user information to your backend via headers.

Whether you're protecting internal tools with Google Workspace, building multi-tenant applications with Cognito, or integrating with your organization's existing identity infrastructure, ALB authentication provides a secure, scalable foundation. The next step is hands-on: pick your identity provider, walk through the registration process, and test the configuration in a non-production environment. Once you see the authentication flow in action—the redirect to login, the callback, the authenticated request reaching your backend—the entire pattern becomes clear.
