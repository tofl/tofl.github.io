---
title: "Cognito User Pool Token Lifecycle: ID Token vs Access Token vs Refresh Token"
---

# Cognito User Pool Token Lifecycle: ID Token vs Access Token vs Refresh Token

When you integrate AWS Cognito into your application, understanding how tokens work is absolutely critical. Many developers treat Cognito tokens as interchangeable—they're all JWTs, right?—only to discover later that using an ID token where an access token is required will silently fail, or worse, introduce security vulnerabilities. The three tokens that Cognito User Pools issues—the ID token, access token, and refresh token—each serve distinct purposes, contain different claims, and have different lifespans. Getting this right means secure authentication, efficient authorization, and a better user experience. Getting it wrong means frustrated users, API failures, and potential security gaps.

In this article, we'll explore the token lifecycle in depth. You'll learn what each token contains, how long it lives, when to use each one, and how to verify them in your application code. By the end, you'll have the knowledge to build robust authentication flows and make informed decisions about token handling in your AWS environment.

### Understanding JWT Tokens and Cognito

Before diving into the specific tokens, let's establish what we're working with. JWT stands for JSON Web Token, and it's a standard format for securely transmitting information between parties. Each JWT consists of three parts separated by dots: a header, a payload, and a signature.

When a user successfully authenticates with a Cognito User Pool, Cognito doesn't just create one token—it creates three. Each token is a separate JWT with its own claims, expiration time, and intended use. This might seem redundant at first, but the separation of concerns is intentional and important. Think of it like a security badge system at a building: you might have one badge that proves you work there (ID token), another that specifies which floors you can access (access token), and a master key that lets you refresh your badges when they expire (refresh token).

### The ID Token: Proving Identity

The ID token is all about identity. Its primary purpose is to answer the question: "Who is this user?" When you need to determine who is currently logged in, you look at the ID token. This is the token you'd use on the client side to display a user's name, email, or profile picture. It's also what you'd pass to your backend if your backend needs to know who the authenticated user is.

The ID token contains identity-related claims. These typically include `sub` (the unique subject identifier for the user), `cognito:username` (the username), `email`, `email_verified`, `name`, `picture`, and other custom attributes you've defined in your user pool. You'll also find standard JWT claims like `iss` (issuer), `aud` (audience), `exp` (expiration time), and `iat` (issued at time).

Here's what a typical ID token payload looks like when decoded:

```json
{
  "sub": "12345678-1234-1234-1234-123456789012",
  "cognito:username": "john.doe",
  "email_verified": true,
  "aud": "3a7f1234567890abcdef123456",
  "event_id": "abc123def456",
  "token_use": "id",
  "auth_time": 1609459200,
  "iss": "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_AbCdEfGhI",
  "cognito:auth_time": 1609459200,
  "exp": 1609462800,
  "iat": 1609459200,
  "email": "john.doe@example.com",
  "name": "John Doe"
}
```

Notice the `token_use` claim is set to `id`. This is a critical field that tells you what type of token this is.

In a typical client-side application, you might decode the ID token to populate your UI with the user's information:

```javascript
// In a React component, after user authenticates
const idToken = userSession.getIdToken().getJwtToken();
const decoded = jwt_decode(idToken);

setUserName(decoded.name);
setUserEmail(decoded.email);
setUserPicture(decoded.picture);
```

An important limitation: the ID token is not meant for authorization decisions on your API. It proves who you are, but it doesn't contain granular permission information. That's what the access token is for.

### The Access Token: Enabling API Operations

The access token is your authorization credential. While the ID token answers "who are you?", the access token answers "what are you allowed to do?" This is the token you should pass to your backend APIs to authorize requests.

The access token contains claims about scopes—permissions that were granted to the user. These scopes define what operations the user can perform. You'll see claims like `token_use` (set to `access`), `scope` (a space-separated list of granted scopes), `username`, `client_id`, and various timing claims. Notably, the access token does not contain identity information like the user's email or name by default.

Here's what a typical access token payload looks like:

```json
{
  "sub": "12345678-1234-1234-1234-123456789012",
  "device_key": "us-east-1_AbCdEfGhI_1234567890",
  "cognito:groups": ["admin"],
  "event_id": "abc123def456",
  "token_use": "access",
  "scope": "aws.cognito.signin.user.admin openid profile email",
  "auth_time": 1609459200,
  "iss": "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_AbCdEfGhI",
  "exp": 1609462800,
  "iat": 1609459200,
  "jti": "unique-jwt-identifier",
  "client_id": "3a7f1234567890abcdef123456",
  "username": "john.doe"
}
```

The key difference here is the `scope` claim and the absence of personally identifiable information. The scopes are what your backend API should check to determine if the user can perform the requested action.

In practice, when your frontend makes an API call to your backend, it includes the access token in the Authorization header:

```javascript
const accessToken = userSession.getAccessToken().getJwtToken();

const response = await fetch('https://api.example.com/user/data', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
```

Your backend then validates this token and checks the scopes before responding:

```python
# In a Flask API endpoint
from functools import wraps
import jwt

def require_scope(required_scope):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            token = request.headers.get('Authorization', '').replace('Bearer ', '')
            decoded = jwt.decode(token, options={"verify_signature": False})
            token_scopes = decoded.get('scope', '').split()
            
            if required_scope in token_scopes:
                return f(*args, **kwargs)
            else:
                return {'error': 'Insufficient permissions'}, 403
        return decorated_function
    return decorator

@app.route('/user/data')
@require_scope('profile')
def get_user_data():
    return {'data': 'sensitive information'}
```

One critical point: the access token is designed for authorization on your APIs, not for proving identity. If you need both identity information and authorization, use the ID token on the client side and the access token for API calls. Some developers mistakenly try to extract user identity from the access token, but that's not its purpose.

### The Refresh Token: Long-Lived Credential for Token Renewal

The refresh token is the longest-lived of the three tokens, and it serves a single, important purpose: obtaining new ID and access tokens without requiring the user to log in again. The refresh token itself contains minimal claims—typically just `token_use` set to `refresh`, along with standard JWT claims.

Here's what a refresh token payload looks like:

```json
{
  "sub": "12345678-1234-1234-1234-123456789012",
  "event_id": "abc123def456",
  "token_use": "refresh",
  "iss": "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_AbCdEfGhI",
  "cognito:jti": "unique-identifier",
  "iat": 1609459200,
  "exp": 1612137600
}
```

Notice how sparse this payload is compared to the ID and access tokens. The refresh token doesn't need to contain detailed claims because it's not meant to be inspected by your application—it's only ever sent to Cognito.

By default, refresh tokens expire after 30 days, though this is configurable in your user pool settings. ID and access tokens, by contrast, typically expire after 1 hour (also configurable). This design means that your ID and access tokens stay relatively short-lived for security, while the refresh token remains valid longer so users don't have to constantly re-authenticate.

When your access token approaches expiration, your application uses the refresh token to get new tokens:

```javascript
// When access token is about to expire
const refreshToken = userSession.getRefreshToken();

const newTokens = await userPool.refreshTokens(refreshToken);
userSession.setIdToken(newTokens.idToken);
userSession.setAccessToken(newTokens.accessToken);
// The refresh token may also be renewed, depending on configuration
```

Behind the scenes, this makes a request to Cognito's token endpoint with the refresh token, and Cognito responds with new ID and access tokens. The refresh token itself may or may not be rotated—that depends on your user pool configuration. If refresh token rotation is enabled, Cognito will issue a new refresh token with each refresh, and the old one becomes invalid. This adds an extra layer of security.

The refresh token is sensitive and should be treated as such. If you're building a web application, store it securely—ideally in an httpOnly cookie that cannot be accessed by JavaScript. If you're building a mobile app, use the platform's secure storage mechanisms. Never expose a refresh token to the browser's JavaScript context.

### Token Lifetimes and Expiration

Understanding token lifetimes is essential for building a smooth user experience. The default configuration in Cognito User Pools is:

- **ID Token**: 1 hour
- **Access Token**: 1 hour
- **Refresh Token**: 30 days

These defaults are reasonable for most applications, but they're configurable per user pool. You might want shorter lifetimes for highly sensitive applications or longer ones for low-risk scenarios.

The expiration time is encoded in the `exp` claim of each JWT. This claim contains a Unix timestamp representing when the token expires. Your application should check this timestamp before using a token, or rely on a JWT library that does this automatically.

When an ID or access token expires, your application should use the refresh token to obtain new ones. The typical flow looks like this:

1. User logs in; Cognito issues ID token, access token, and refresh token
2. Application stores all three tokens
3. User makes API requests using the access token
4. Access token expires (or is about to expire)
5. Application uses the refresh token to request new tokens
6. Cognito validates the refresh token and issues new ID and access tokens
7. Application updates stored tokens and continues

If the refresh token also expires, the user must log in again. In a well-designed application, the user should rarely notice this token refresh happening in the background.

### Verifying Token Signatures Locally

When your backend receives a token, it needs to verify that the token is legitimate and hasn't been tampered with. This is where the JWT signature comes in. Each token is signed with Cognito's private key, and you can verify it using Cognito's public keys.

Cognito publishes its public keys in a JWKS (JSON Web Key Set) endpoint. For a user pool in us-east-1 with pool ID `us-east-1_AbCdEfGhI`, the endpoint would be:

```
https://cognito-idp.us-east-1.amazonaws.com/us-east-1_AbCdEfGhI/.well-known/jwks.json
```

This endpoint returns something like:

```json
{
  "keys": [
    {
      "alg": "RS256",
      "e": "AQAB",
      "kid": "abc123+abc123abc123abc123abc123abc123abc=",
      "kty": "RSA",
      "n": "long-base64-encoded-value",
      "use": "sig"
    }
  ]
}
```

To verify a token, you extract the `kid` (key ID) from the token's header, fetch the corresponding public key from this endpoint, and verify the signature. Most JWT libraries handle this for you. Here's an example in Python using PyJWT:

```python
import jwt
import requests

def verify_cognito_token(token, user_pool_id, region):
    # Fetch public keys
    jwks_url = f"https://cognito-idp.{region}.amazonaws.com/{user_pool_id}/.well-known/jwks.json"
    jwks = requests.get(jwks_url).json()
    
    # Decode header to get kid
    header = jwt.get_unverified_header(token)
    kid = header.get('kid')
    
    # Find the matching key
    public_key = None
    for key in jwks['keys']:
        if key['kid'] == kid:
            public_key = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(key))
            break
    
    if not public_key:
        raise ValueError("Public key not found")
    
    # Verify and decode
    decoded = jwt.decode(token, public_key, algorithms=['RS256'])
    return decoded
```

In practice, you'd typically cache the public keys for a period of time rather than fetching them for every token verification. This reduces latency and load on Cognito's endpoints.

### Choosing the Right Token for the Right Job

Here's where understanding token purposes becomes practical. Let's walk through several common scenarios:

**Scenario 1: Displaying User Information in Your Frontend**

You're building a React application and want to display the logged-in user's name and email in the navigation bar. Use the ID token. Decode it on the client side and extract the `name` and `email` claims. This is exactly what the ID token is designed for.

**Scenario 2: Calling Your Backend API**

Your frontend needs to fetch user data from your backend API. Use the access token. Include it in the Authorization header as `Bearer <access_token>`. Your backend validates it and checks the scopes to determine if the request should be allowed.

**Scenario 3: Determining if a User Can Perform an Action**

You need to check if a user has permission to delete a resource. Don't use the ID token for this—it contains identity information, not authorization information. Instead, use the access token's scopes, or better yet, include custom claims in the access token (via Lambda authorizers or Cognito's custom attributes) that specify what the user can do.

**Scenario 4: User Session Has Expired**

The user's ID and access tokens have expired. The refresh token is still valid. Use the refresh token to get new ID and access tokens without asking the user to log in again.

**Scenario 5: Invoking an AWS Service on Behalf of the User**

You're building an application where users can upload files to their own S3 bucket. You can't use the Cognito tokens directly for S3—you need AWS credentials. This is where identity federation comes in. You'd use the ID token with Cognito Identity to assume an IAM role and get temporary AWS credentials. (This is a more advanced scenario, but it's important to understand that Cognito User Pool tokens don't directly grant AWS API access—you need the Cognito Identity service for that.)

### Token Rotation and Security Best Practices

Token rotation is the practice of regularly issuing new tokens before old ones expire. This limits the window of vulnerability if a token is compromised. Cognito supports refresh token rotation, which means each time you use a refresh token, you get back a new refresh token and the old one is invalidated.

To enable this in your user pool, configure the refresh token expiration and enable token rotation in the user pool's token settings. With rotation enabled, you must store and update your refresh token each time you refresh your access token.

From a security perspective, here are several important practices:

Always validate the `token_use` claim to ensure you're using the token for its intended purpose. If your backend receives a token with `token_use: id`, that's a sign something is wrong—the client should have sent the access token.

Keep token lifetimes as short as practical. The default of 1 hour is reasonable, but if you're building a high-security application, consider 15 or 30 minutes for access tokens.

Store refresh tokens securely. In web applications, use httpOnly cookies that cannot be accessed by JavaScript. In mobile applications, use platform-specific secure storage. Never expose refresh tokens in local storage or session storage.

Implement token refresh logic that transparently refreshes tokens before they expire. This provides a smooth user experience and ensures you always have valid tokens.

Validate tokens on every request that requires authentication. Don't trust tokens that have already been validated by another part of your system—each endpoint should perform its own validation.

### Handling Token Expiration and Refresh in Your Application

Let's look at a practical implementation of token refresh in a Node.js backend using Express and the AWS SDK:

```javascript
const express = require('express');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const app = express();
const userPoolId = 'us-east-1_AbCdEfGhI';
const region = 'us-east-1';
const jwksUrl = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;

const client = jwksClient({
  jwksUri: jwksUrl,
  cache: true,
  cacheMaxEntries: 10,
  cacheMaxAge: 600000 // 10 minutes
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

function verifyToken(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, getKey, {
      algorithms: ['RS256']
    }, (err, decoded) => {
      if (err) reject(err);
      else resolve(decoded);
    });
  });
}

app.get('/api/protected', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    
    const decoded = await verifyToken(token);
    
    // Verify token_use claim
    if (decoded.token_use !== 'access') {
      return res.status(401).json({ error: 'Invalid token type' });
    }
    
    // Check scopes
    const requiredScope = 'api/read';
    const tokenScopes = decoded.scope?.split(' ') || [];
    if (!tokenScopes.includes(requiredScope)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    res.json({ message: 'Access granted', username: decoded.username });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.listen(3000);
```

On the frontend, you'd implement refresh logic that automatically refreshes tokens as needed:

```javascript
class CognitoTokenManager {
  constructor(userPool, tokenRefreshThreshold = 5 * 60 * 1000) { // 5 minutes
    this.userPool = userPool;
    this.refreshThreshold = tokenRefreshThreshold;
    this.refreshTimer = null;
  }
  
  async initialize(userSession) {
    this.userSession = userSession;
    this.scheduleRefresh();
  }
  
  scheduleRefresh() {
    const accessToken = this.userSession.getAccessToken();
    const expiresIn = accessToken.getExpiration() * 1000 - Date.now();
    const timeUntilRefresh = expiresIn - this.refreshThreshold;
    
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    
    if (timeUntilRefresh > 0) {
      this.refreshTimer = setTimeout(() => this.refresh(), timeUntilRefresh);
    }
  }
  
  async refresh() {
    try {
      const refreshToken = this.userSession.getRefreshToken();
      const newTokens = await this.userPool.refreshTokens(refreshToken);
      
      this.userSession.setIdToken(newTokens.idToken);
      this.userSession.setAccessToken(newTokens.accessToken);
      
      if (newTokens.refreshToken) {
        this.userSession.setRefreshToken(newTokens.refreshToken);
      }
      
      this.scheduleRefresh();
    } catch (err) {
      console.error('Token refresh failed:', err);
      // Redirect to login
      window.location.href = '/login';
    }
  }
}
```

### Common Mistakes and How to Avoid Them

One frequent mistake is using the ID token for API authorization. The ID token contains identity claims, not authorization scopes. Always use the access token for API calls. If you need both identity information and authorization, use the ID token on the client side and the access token for backend requests.

Another common error is not checking the `token_use` claim when validating tokens. While less common in well-designed systems, a compromised or confused client might send the wrong token type. Validating this claim is a simple but effective security check.

Many developers also forget to implement token refresh logic, leading to frequent logout experiences. The refresh token exists to solve this problem. Implement automatic refresh before token expiration, and your users will have a much better experience.

Some teams store refresh tokens insecurely, such as in local storage in web applications. This violates best practices and exposes refresh tokens to cross-site scripting attacks. Use httpOnly cookies for web applications.

Finally, avoid validating tokens offline without periodically checking the token revocation status. While verifying the signature is good practice, it doesn't tell you if the token has been revoked (for example, after the user changed their password). For truly sensitive operations, consider calling Cognito to verify the user session is still active.

### Conclusion

The three tokens issued by Cognito User Pools—ID token, access token, and refresh token—each play a specific role in your authentication and authorization architecture. The ID token establishes who the user is, the access token authorizes what they can do, and the refresh token keeps them from having to log in repeatedly. Understanding these distinctions and implementing proper token handling in your application is fundamental to building secure, user-friendly applications with AWS Cognito.

By carefully considering which token to use in each scenario, verifying tokens appropriately, implementing automatic refresh logic, and following security best practices around token storage and validation, you'll build authentication systems that are both secure and provide excellent user experiences. The time invested in understanding token lifecycles pays dividends across your entire application architecture.
