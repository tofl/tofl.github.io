---
title: "Authenticating OpenSearch Dashboards with Amazon Cognito"
---

## Authenticating OpenSearch Dashboards with Amazon Cognito

When you deploy Amazon OpenSearch in a production environment, exposing OpenSearch Dashboards to your organization without authentication is simply not an option. You need a robust identity and access control layer that integrates seamlessly with your existing infrastructure while keeping your data safe from unauthorized access. This is where Amazon Cognito becomes invaluable—it provides a managed authentication and authorization service that integrates directly with OpenSearch, eliminating the need to build custom authentication logic or manage identity infrastructure yourself.

In this article, we'll walk through the complete process of securing OpenSearch Dashboards with Cognito authentication. We'll start by understanding why this matters, then move through creating the necessary Cognito resources, configuring your OpenSearch domain, mapping user groups to security roles, and exploring alternative approaches like SAML for enterprise environments. By the end, you'll have a clear understanding of how to implement production-grade authentication for OpenSearch Dashboards.

### Why Cognito Authentication for OpenSearch Dashboards Matters

OpenSearch Dashboards is a powerful visualization and exploration tool, but it's also a gateway to your underlying data. Without proper authentication, anyone who can reach your domain—whether through an internal network or exposed endpoint—can potentially access, query, and visualize sensitive information.

Cognito addresses this challenge by inserting an authentication layer between your users and Dashboards. When you integrate Cognito with OpenSearch, several important security benefits emerge. First, users must authenticate before they can even see Dashboards. Second, Cognito manages the authentication tokens and sessions, reducing the burden on your application. Third, you can leverage Cognito's role-based access control to map users and groups to OpenSearch security roles, enabling fine-grained permissions within Dashboards itself. Fourth, Cognito provides a centralized identity management system, making it easier to onboard, offboard, and manage user access at scale.

For production deployments, this level of control is essential. It's the difference between a proof-of-concept and a secure, maintainable system.

### Understanding the Architecture

Before we dive into the implementation details, let's clarify how Cognito and OpenSearch work together. OpenSearch Dashboards doesn't natively understand Cognito—it uses the OAuth 2.0 and SAML 2.0 protocols to delegate authentication. Cognito acts as an identity provider, handling the actual authentication of users. OpenSearch's advanced security features then map the authenticated user to OpenSearch roles and permissions.

The typical flow looks like this: a user navigates to their OpenSearch Dashboards URL, OpenSearch detects the user isn't authenticated, and redirects them to a Cognito-hosted login page. The user enters their credentials, and Cognito validates them. If successful, Cognito redirects the user back to Dashboards with an authorization code. OpenSearch exchanges this code for an ID token and access token, verifies the token, and uses information within it to determine what the user can do inside Dashboards. This entire process happens transparently to the user—they simply sign in once and gain access.

### Creating Your Cognito User Pool

The first step is to create a Cognito User Pool, which serves as your user directory. A User Pool is a fully managed user authentication service within Cognito that handles user sign-up, sign-in, password reset, and other identity operations.

Navigate to the Cognito console and create a new User Pool. During creation, you'll need to make several configuration decisions. For the sign-in experience, choose the appropriate option based on your organization's needs. If you want users to sign in with an email address, select that option. For password policy, AWS provides sensible defaults, but you can customize minimum length, complexity requirements, and expiration policies to match your security standards.

Here's a practical example of creating a User Pool using the AWS CLI:

```bash
aws cognito-idp create-user-pool \
  --pool-name opensearch-dashboards-pool \
  --policies PasswordPolicy={MinimumLength=12,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=true} \
  --auto-verified-attributes email \
  --username-attributes email
```

This command creates a User Pool with strong password requirements and configures the pool to treat email addresses as usernames. After creation, you'll need to create a User Pool client, which is the application interface through which Dashboards will communicate with the User Pool.

```bash
aws cognito-idp create-user-pool-client \
  --user-pool-id us-east-1_xxxxxxxxx \
  --client-name opensearch-dashboards-client \
  --generate-secret \
  --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --callback-urls "https://your-opensearch-domain.us-east-1.es.amazonaws.com/_dashboards/auth/cognito/callback"
```

Pay careful attention to the callback URL—this is where Cognito will send users after they authenticate. The exact format depends on your domain name and region. The callback URL must exactly match what you'll configure in OpenSearch later, or authentication will fail with an opaque error message.

### Creating Your Cognito Identity Pool

While the User Pool handles authentication (verifying who you are), the Identity Pool handles authorization (determining what you can do). The Identity Pool exchanges the tokens from your User Pool for AWS credentials that can be used to access AWS services.

Create an Identity Pool in the Cognito console:

```bash
aws cognito-identity create-identity-pool \
  --identity-pool-name opensearch-dashboards-identity-pool \
  --allow-unauthenticated-identities false \
  --cognito-identity-providers ProviderName=cognito-idp.us-east-1.amazonaws.com/us-east-1_xxxxxxxxx,ClientId=your-client-id,ServerSideTokenValidation=true
```

The `AllowUnauthenticatedIdentities` parameter should be `false` for security reasons—you don't want unauthenticated users receiving any AWS credentials. The `CognitoIdentityProviders` parameter links your Identity Pool to your User Pool and client.

### Configuring Your OpenSearch Domain for Cognito

Now that you have Cognito resources in place, you need to tell your OpenSearch domain to use them for authentication. This configuration lives in the OpenSearch domain's access policies and authentication settings.

First, navigate to your OpenSearch domain in the AWS console and access the security configuration. You'll find options to enable fine-grained access control (which is required for Cognito authentication) and to configure identity providers.

In the authentication settings, select "Amazon Cognito" as your identity provider. You'll need to provide:

* Your User Pool ID
* Your Identity Pool ID
* Your Cognito region (typically where you created your resources)

Here's an example of what this configuration looks like programmatically:

```bash
aws opensearch update-domain-config \
  --domain-name your-domain \
  --cognito-options Enabled=true,UserPoolId=us-east-1_xxxxxxxxx,IdentityPoolId=us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx,RoleArn=arn:aws:iam::123456789012:role/OpenSearchCognitoRole
```

The RoleArn parameter points to an IAM role that OpenSearch assumes to call Cognito APIs. This role needs permissions to describe the User Pool and Identity Pool. Here's a minimal IAM policy for this role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cognito-idp:DescribeUserPool",
        "cognito-idp:DescribeUserPoolClient",
        "cognito-identity:DescribeIdentityPool"
      ],
      "Resource": [
        "arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_xxxxxxxxx",
        "arn:aws:cognito-identity:us-east-1:123456789012:identitypool/us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
      ]
    }
  ]
}
```

After updating your domain configuration, OpenSearch will apply the changes, which may take several minutes. During this time, your domain is unavailable. Once complete, OpenSearch Dashboards will automatically redirect unauthenticated users to the Cognito login page.

### Mapping Cognito Groups to OpenSearch Roles

At this point, your users can authenticate against Cognito and access Dashboards. However, they all have the same permissions—likely administrative permissions if you haven't restricted access further. In production environments, you need fine-grained control over who can do what within Dashboards.

OpenSearch's role-based access control allows you to create roles with specific permissions (like viewing certain indexes or running specific queries) and map Cognito groups to these roles. Users who belong to a Cognito group automatically receive the permissions associated with the corresponding OpenSearch role.

First, create a Cognito group:

```bash
aws cognito-idp create-group \
  --group-name opensearch-admins \
  --user-pool-id us-east-1_xxxxxxxxx \
  --description "Users with full OpenSearch Dashboards access"
```

Next, add a user to the group:

```bash
aws cognito-idp admin-add-user-to-group \
  --user-pool-id us-east-1_xxxxxxxxx \
  --username user@example.com \
  --group-name opensearch-admins
```

Now, you need to configure the Cognito User Pool client to include group information in the ID token that's sent to OpenSearch. In the Cognito console, navigate to your User Pool client settings and ensure that "ID Token" includes the "cognito:groups" claim. This claim will list all groups the user belongs to.

In OpenSearch, create a role that corresponds to your Cognito group. You can do this through the OpenSearch Dashboards UI or via the API:

```bash
curl -X PUT "https://your-domain.us-east-1.es.amazonaws.com/_plugins/_security/api/roles/opensearch_admins_role" \
  -H "Content-Type: application/json" \
  -d '{
    "cluster_permissions": ["*"],
    "index_permissions": [{
      "index_patterns": ["*"],
      "allowed_actions": ["*"]
    }],
    "tenant_permissions": [{
      "tenant_patterns": ["*"],
      "allowed_actions": ["*"]
    }]
  }'
```

Finally, map the Cognito group to the OpenSearch role. This is done through the role mapping configuration:

```bash
curl -X PUT "https://your-domain.us-east-1.es.amazonaws.com/_plugins/_security/api/rolesmapping/opensearch_admins_role" \
  -H "Content-Type: application/json" \
  -d '{
    "backend_roles": [],
    "hosts": [],
    "users": [],
    "and_backend_roles": [],
    "groups": ["opensearch-admins"]
  }'
```

The key here is the `groups` array—it specifies which Cognito groups should receive this role. When a user from the "opensearch-admins" Cognito group logs in, OpenSearch will automatically grant them the "opensearch_admins_role" permissions.

### Using SAML for Enterprise Single Sign-On

While Cognito User Pools work well for many organizations, enterprises often have existing identity providers like Active Directory, Okta, or Azure AD. Rather than duplicating user management in Cognito, you can configure your Cognito User Pool to act as a SAML identity provider bridge, allowing your existing enterprise identity provider to authenticate users for OpenSearch Dashboards.

To set up SAML, you'll first configure your enterprise identity provider to use Cognito as a service provider. Your identity provider will require a metadata URL from your Cognito User Pool. In the Cognito console, navigate to your User Pool, go to "App integration" and then "App client settings", and you'll find a link to the SAML metadata. This metadata contains the information your identity provider needs to send SAML assertions to Cognito.

Next, configure your Cognito User Pool to accept SAML assertions from your identity provider. In the console, go to "Identity providers" and add a SAML provider. You'll need to upload the metadata from your enterprise identity provider. Cognito will extract the certificate and endpoint information needed to validate incoming SAML assertions.

Once the SAML provider is configured in Cognito, the authentication flow changes slightly. When a user visits OpenSearch Dashboards, they're redirected to the Cognito login page. Instead of entering credentials, they click a "Log in with [Your Enterprise Provider]" button, which redirects them to your enterprise identity provider. After authenticating there, they're redirected back to Cognito with a SAML assertion. Cognito validates the assertion, creates a Cognito user if one doesn't exist, and completes the login flow back to Dashboards.

The beauty of this approach is that user management remains centralized in your enterprise directory, and access provisioning and deprovisioning happen automatically. When you remove a user from your enterprise directory, they can no longer authenticate to OpenSearch Dashboards.

### Configuring OpenSearch for SAML

If you prefer to use SAML directly with OpenSearch (bypassing the Cognito User Pool as an intermediary), you can configure OpenSearch to accept SAML assertions directly from your identity provider. This approach gives you more direct control but requires managing SAML configuration in OpenSearch itself.

In the OpenSearch domain configuration, select "SAML" as your authentication method and provide the metadata URL from your identity provider. OpenSearch will periodically fetch and update the SAML metadata, ensuring that certificate rotations and configuration changes are automatically recognized.

You'll also need to configure role mappings for SAML, similar to what we did with Cognito groups. In OpenSearch, SAML attributes can be mapped to OpenSearch roles:

```bash
curl -X PUT "https://your-domain.us-east-1.es.amazonaws.com/_plugins/_security/api/rolesmapping/opensearch_admins_role" \
  -H "Content-Type: application/json" \
  -d '{
    "backend_roles": [],
    "hosts": [],
    "users": [],
    "and_backend_roles": ["admin"],
    "groups": []
  }'
```

In this example, users with the "admin" backend role (typically derived from SAML attributes) receive the OpenSearch admin role.

### Troubleshooting Common Authentication Issues

Even with everything configured correctly, you may encounter login issues. Understanding the common problems and how to diagnose them will save you considerable frustration.

**The redirect loop problem** occurs when a user is continuously redirected between Dashboards and the Cognito login page without ever successfully authenticating. The most common cause is a callback URL mismatch. The callback URL you configured in the Cognito User Pool client must exactly match the URL that Cognito receives after authentication. Check both the Cognito client configuration and the OpenSearch domain configuration. Ensure you're using the correct protocol (https), domain name, and path. Even a trailing slash difference can cause issues.

**Token validation failures** manifest as "Invalid token" errors after login. This typically happens when the system clock on your OpenSearch nodes is out of sync with your authentication system. AWS uses token timestamps for validation—if the clocks differ significantly, tokens appear expired or not-yet-valid. Ensure all systems are using NTP for time synchronization.

**Missing group information** in tokens prevents proper role mapping. If users log in successfully but don't receive the expected permissions, check that your Cognito User Pool client is configured to include group claims in the ID token. Some clients require explicit configuration to include this information. Additionally, verify that the role mapping in OpenSearch references the correct group names—group names are case-sensitive.

**Permission denied after login** suggests that the role mapping exists but the role itself lacks necessary permissions. If a user authenticates successfully but can't view any indexes or create visualizations, the mapped role may not have sufficient permissions. Check both the role definition and the role mapping using the OpenSearch API to confirm what permissions are being assigned.

When troubleshooting, enable debug logging in OpenSearch. Add the following to your opensearch.yml configuration:

```yaml
logger.level: DEBUG
logger.org.opensearch.security: DEBUG
```

Then examine the OpenSearch logs for detailed information about what's happening during authentication. The logs will show whether tokens are being validated, which roles are being assigned, and where authentication is failing.

### Best Practices for Production Deployments

When you're ready to move to production, several best practices will ensure your authentication system is secure, maintainable, and reliable.

First, always use strong password policies in your Cognito User Pool. Require at least 12 characters with a mix of uppercase, lowercase, numbers, and special characters. Consider enabling multi-factor authentication for an additional security layer, especially for administrative users who have higher privileges in Dashboards.

Second, implement least-privilege access by default. Create multiple OpenSearch roles with progressively more permissions—one for analysts (read-only access to certain indexes), one for data engineers (ability to create indexes and run aggregations), and one for administrators. Map users to the most restrictive role that lets them do their job. This way, if credentials are compromised, the damage is limited.

Third, regularly audit your role mappings and group memberships. Ensure that users who have left your organization or changed roles are removed from Cognito groups and that their access to Dashboards is revoked. Implement a quarterly review process where team leads verify that their team members still need the access they've been granted.

Fourth, monitor authentication failures and anomalies. CloudWatch logs from your OpenSearch domain include authentication events. Set up CloudWatch alarms to alert you when authentication failures spike, which could indicate a credential compromise or an attacker attempting to gain access.

Finally, implement a robust backup and disaster recovery process for your OpenSearch domain. Your authentication configuration is part of the domain configuration, so ensure you have procedures to recreate the authentication setup in case of domain failure.

### Next Steps and Related Considerations

Once you've secured OpenSearch Dashboards with authentication, you'll likely want to implement additional security measures. Consider using Amazon OpenSearch's encryption at rest to protect data stored on disk, and enable encryption in transit to protect data moving across the network. You might also want to restrict network access to your domain using VPC security groups or IP-based access policies, limiting who can even reach the endpoint.

As your organization grows, you may need to implement more sophisticated identity federation scenarios. Some enterprises use AWS IAM Identity Center to manage access across multiple AWS accounts and applications, with OpenSearch being one of many resources. Cognito integrates with IAM Identity Center, allowing you to extend your identity infrastructure across your entire AWS environment.

The combination of Cognito authentication and OpenSearch's role-based access control provides a powerful, flexible foundation for secure Dashboards access. Whether you're a small team or a large enterprise, the patterns we've covered here scale to your needs—from a simple user pool with a few groups to a complex federated identity system spanning multiple identity providers. With authentication and authorization in place, you can confidently expose OpenSearch Dashboards to your organization, knowing that data access is controlled, auditable, and aligned with your security policies.
