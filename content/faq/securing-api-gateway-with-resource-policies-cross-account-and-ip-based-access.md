---
title: "Securing API Gateway with Resource Policies: Cross-Account and IP-Based Access"
---

## Securing API Gateway with Resource Policies: Cross-Account and IP-Based Access

API Gateway is often the front door of your AWS application—the first point of contact for clients calling your microservices, Lambda functions, or backend systems. While authentication and authorization are critical, there's a layer of security that sits even closer to the door: resource policies. These policies act as a perimeter defense mechanism, letting you control who can even attempt to call your API at the network and account level, before any other authorization logic kicks in.

In this article, we'll explore how to write effective resource policies for API Gateway REST APIs, enforcing security boundaries across accounts, IP ranges, and VPC endpoints. Whether you're building a multi-account architecture, restricting an internal API to corporate networks, or allowing trusted partners from other AWS accounts, resource policies give you the control you need.

### Understanding API Gateway Resource Policies

A resource policy for API Gateway is a JSON-based access control document that you attach directly to an API. It's evaluated *before* method-level authorization settings like IAM roles, Lambda authorizers, or Cognito. Think of it as a gatekeeper standing outside your API Gateway: if the request doesn't pass the resource policy check, it's rejected immediately, regardless of what other authorization mechanisms you've configured downstream.

This is fundamentally different from IAM policies attached to users or roles. While IAM policies describe what a principal (user, role, service) is allowed to do, a resource policy describes who is allowed to access a specific resource and under what conditions. For API Gateway, it's the last line of defense at the resource level.

The key advantage of resource policies is their specificity. You can define rules based on:

- The AWS account or principal making the request
- The source IP address or IP range
- VPC endpoint conditions
- AWS service principals
- Custom conditions using the policy language

When you attach a resource policy to an API, API Gateway evaluates the policy before routing the request to your authorizers, Lambda functions, or integrations. If the policy explicitly denies the request, an `AccessDenied` error is returned. If there's no explicit allow, the request is also denied.

### The Anatomy of an API Gateway Resource Policy

Before diving into specific scenarios, let's examine the structure of a typical API Gateway resource policy. The policy document follows the standard AWS policy format with some API Gateway-specific elements:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789012:root"
      },
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:us-east-1:123456789012:abcdef1234/*/*/*"
    }
  ]
}
```

The `Action` for API Gateway is always `execute-api:Invoke`. The `Resource` follows a specific format: `arn:aws:execute-api:region:account-id:api-id/stage/http-method/resource-path`. The wildcards are crucial here—using `*` for HTTP method and path lets you apply the policy broadly, or you can be granular and specify exact methods and paths.

The `Principal` field identifies who is allowed (or denied). This can be an AWS account, an IAM role, a service principal, or even `*` to mean anyone. When you use `"Principal": "*"`, you're saying the policy applies to all principals, but you typically pair this with conditions to narrow the scope—for instance, allowing only specific IP addresses.

### Denying Access from Unwanted AWS Accounts

One of the most common use cases for resource policies is preventing specific AWS accounts from accessing your API. Imagine you're hosting an internal API and want to ensure it can only be called from your own AWS accounts, not from customer accounts or external partners.

Here's a policy that explicitly denies any principal from a specific AWS account:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Principal": {
        "AWS": "arn:aws:iam::999999999999:root"
      },
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:us-east-1:123456789012:abcdef1234/*/*/*"
    }
  ]
}
```

When you use an explicit `Deny`, it takes precedence over any `Allow` statement. This is powerful because it acts as a kill switch—no matter what other policies are in place, a deny always wins.

However, a more practical approach for most scenarios is to use an explicit allow for your trusted accounts and implicitly deny everything else:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": [
          "arn:aws:iam::123456789012:root",
          "arn:aws:iam::111111111111:root",
          "arn:aws:iam::222222222222:root"
        ]
      },
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:us-east-1:123456789012:abcdef1234/*/*/*"
    }
  ]
}
```

In this example, only principals from three specific AWS accounts can invoke the API. Any request from other accounts is implicitly denied. Note that using `arn:aws:iam::ACCOUNT:root` grants access to the entire account—any IAM role or user within that account can invoke the API. If you want finer control, you can specify individual role ARNs instead.

### Restricting Access by IP Address and CIDR Blocks

IP-based restrictions are essential for internal APIs that should only be accessible from corporate networks. A common scenario involves restricting API access to requests originating from your corporate IP range or VPN.

Here's how to restrict access to a specific IP range:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:us-east-1:123456789012:abcdef1234/*/*/*",
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": [
            "203.0.113.0/24",
            "198.51.100.0/24"
          ]
        }
      }
    }
  ]
}
```

This policy allows anyone to invoke the API, but only if their request comes from one of the two specified CIDR blocks. The `Principal` is set to `*` (everyone), which might seem risky at first, but the condition restricts access to the specified IP ranges. If a request arrives from any other IP, it's denied.

You can also combine IP restrictions with account restrictions for defense-in-depth:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789012:root"
      },
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:us-east-1:123456789012:abcdef1234/*/*/*",
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": "10.0.0.0/8"
        }
      }
    }
  ]
}
```

This allows the specified AWS account to invoke the API, but only from IP addresses within the 10.0.0.0/8 range (typically internal AWS networks or VPN-connected clients).

### VPC Endpoint Conditions and Private APIs

For truly sensitive workloads, you might want to ensure that API access happens only through a VPC endpoint—essentially allowing only traffic that originates from within your VPC or a connected network.

API Gateway supports the `aws:SourceVpce` condition, which checks the source VPC endpoint:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:us-east-1:123456789012:abcdef1234/*/*/*",
      "Condition": {
        "StringEquals": {
          "aws:SourceVpce": "vpce-1234567890abcdef0"
        }
      }
    }
  ]
}
```

This policy allows invocation of the API only if the request comes through the specified VPC endpoint. This is particularly useful for preventing direct internet access to your API while allowing internal services to communicate through a private network path.

You can also combine VPC endpoint conditions with account restrictions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789012:root"
      },
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:us-east-1:123456789012:abcdef1234/*/*/*",
      "Condition": {
        "StringEquals": {
          "aws:SourceVpc": "vpc-12345678"
        }
      }
    }
  ]
}
```

The `aws:SourceVpc` condition is particularly useful in multi-VPC architectures, ensuring that only resources within a specific VPC can access the API.

### Cross-Account Access for Partners and Subsidiaries

In many enterprises, you need to grant access to APIs from trusted partner AWS accounts or subsidiary organizations. Resource policies make this straightforward while maintaining security boundaries.

Consider a scenario where you have a partner company that needs to call your order processing API. Their AWS account ID is `999888777666`. Here's how you'd grant them access:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::999888777666:root"
      },
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:us-east-1:123456789012:abcdef1234/*/*/*"
    }
  ]
}
```

However, if you want to be more restrictive and only allow a specific role within the partner account, you can specify the role ARN directly:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::999888777666:role/PartnerIntegrationRole"
      },
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:us-east-1:123456789012:abcdef1234/*/*/*"
    }
  ]
}
```

For enhanced security, you can add conditions to this cross-account access. For instance, you might want to allow the partner account to access the API only from their corporate IP range:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::999888777666:role/PartnerIntegrationRole"
      },
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:us-east-1:123456789012:abcdef1234/*/*/*",
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": "192.0.2.0/24"
        }
      }
    }
  ]
}
```

This is a strong pattern for multi-account architectures: you grant access to the other account but add conditions to ensure the access happens within expected parameters.

### Restricting Specific Methods or Resources

Resource policies aren't limited to broad all-or-nothing access. You can be granular about which API methods and paths are accessible under different conditions.

Suppose you have a public API where most operations are read-only and accessible to everyone, but administrative operations (POST, PUT, DELETE) should only be allowed from your corporate network. You can achieve this with multiple statements:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "execute-api:Invoke",
      "Resource": [
        "arn:aws:execute-api:us-east-1:123456789012:abcdef1234/prod/GET/*",
        "arn:aws:execute-api:us-east-1:123456789012:abcdef1234/prod/HEAD/*"
      ]
    },
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "execute-api:Invoke",
      "Resource": [
        "arn:aws:execute-api:us-east-1:123456789012:abcdef1234/prod/POST/*",
        "arn:aws:execute-api:us-east-1:123456789012:abcdef1234/prod/PUT/*",
        "arn:aws:execute-api:us-east-1:123456789012:abcdef1234/prod/DELETE/*"
      ],
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": "203.0.113.0/24"
        }
      }
    }
  ]
}
```

The first statement allows read-only access (GET, HEAD) from anywhere. The second statement allows modification operations (POST, PUT, DELETE) only from the specified IP range. This way, you enforce different security policies for different parts of your API without needing to duplicate authorization logic in your Lambda functions.

### Interaction with IAM Authorization, Lambda Authorizers, and Cognito

A crucial point to understand is how resource policies interact with other authorization mechanisms in API Gateway. The evaluation order is:

1. Resource policy is evaluated first
2. If the resource policy denies the request, it's rejected immediately with `AccessDenied`
3. If the resource policy allows (or doesn't explicitly deny) the request, it proceeds to the method's authorization settings
4. Method-level authorization (IAM, Lambda authorizer, Cognito) is then evaluated

This means a resource policy acts as a gatekeeper—it filters requests before they reach your method-level authorizers. This is valuable for performance and security. If you can reject a request at the resource policy level, your Lambda authorizers and backend services never see it.

Consider a practical example. You have a Lambda authorizer that validates JWT tokens and a resource policy that restricts access by IP address. A request from outside your allowed IP ranges would be rejected at the resource policy level, never reaching the Lambda authorizer. This saves Lambda invocations and reduces latency.

If you're using IAM authorization (with `AWS_IAM` as the authorization type), the resource policy and IAM policies work together. The resource policy is evaluated first. If it allows the request to proceed, then IAM policies attached to the caller's role are evaluated. Both must allow the action for the request to succeed.

With Lambda authorizers, the resource policy is independent of your authorization logic. The authorizer runs *after* the resource policy, assuming the request passes the resource policy check. This means your Lambda authorizer doesn't need to re-enforce constraints already covered by the resource policy—such as IP ranges or account restrictions—though there's no harm in doing so for defense-in-depth.

For Cognito authorization, similarly, the resource policy is a separate layer. You can use the resource policy to add IP-based or VPC-based restrictions on top of your Cognito user pool authorization. This is particularly useful in hybrid scenarios where you want authenticated Cognito users to access your API, but only from specific networks.

### Real-World Scenario: Internal API with Corporate IP Restrictions

Let's walk through a concrete scenario that combines several of the concepts we've covered.

You maintain an internal API called `/hr-systems` that should only be accessible from your corporate network. Your company has:
- A main office with IP range 203.0.113.0/24
- A secondary office with IP range 198.51.100.0/24
- Remote workers who connect through a corporate VPN with IP range 192.0.2.0/24

Your API runs in account `123456789012` and has the ID `abcdef1234`. Here's the resource policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:us-east-1:123456789012:abcdef1234/*/*/*",
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": [
            "203.0.113.0/24",
            "198.51.100.0/24",
            "192.0.2.0/24"
          ]
        }
      }
    }
  ]
}
```

With this policy in place:
- An employee in the main office can call the API
- An employee in the secondary office can call the API
- A remote employee on the VPN can call the API
- An employee on their home internet, outside the VPN, cannot call the API
- A request from anywhere else on the internet is rejected

Even if you've set up a Lambda authorizer to validate an internal token, or IAM authorization, the resource policy acts as the first line of defense. Any request from outside the corporate IP ranges is rejected before reaching your authorization logic.

### Real-World Scenario: Multi-Account Data Lake API

In a different scenario, you have a data lake hosted in the central data platform account (`111111111111`), and multiple business units have APIs in their own AWS accounts that need to query the data lake. You want to allow specific roles from each business unit account to access the data lake API, but deny access from all other sources.

Your data lake API is in account `111111111111` with API ID `datalakelake`. Here's the resource policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": [
          "arn:aws:iam::222222222222:role/BusinessUnitADataAccess",
          "arn:aws:iam::333333333333:role/BusinessUnitBDataAccess",
          "arn:aws:iam::444444444444:role/BusinessUnitCDataAccess"
        ]
      },
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:us-east-1:111111111111:datalakelake/*/*/*"
    }
  ]
}
```

This policy grants access only to the specified roles from the three business unit accounts. Requests from other accounts, or from different roles within those accounts, are denied. The business units can then use their respective roles in Lambda functions or EC2 instances to call the data lake API.

For additional security, you could add conditions to allow access only from specific VPC endpoints in each business unit's VPC:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": [
          "arn:aws:iam::222222222222:role/BusinessUnitADataAccess",
          "arn:aws:iam::333333333333:role/BusinessUnitBDataAccess",
          "arn:aws:iam::444444444444:role/BusinessUnitCDataAccess"
        ]
      },
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:us-east-1:111111111111:datalakelake/*/*/*",
      "Condition": {
        "StringEquals": {
          "aws:SourceVpc": [
            "vpc-aaaaaa",
            "vpc-bbbbbb",
            "vpc-cccccc"
          ]
        }
      }
    }
  ]
}
```

This ensures that not only must the request come from the right role in the right account, but it must also originate from the expected VPC. This prevents lateral movement or access from unexpected network locations.

### Troubleshooting AccessDenied Errors

When your resource policy is in place and requests are being denied, debugging can be tricky. Here are the most common causes of `AccessDenied` errors and how to diagnose them:

**Incorrect Principal ARN**: The most frequent mistake is specifying an incorrect IAM role or account ARN. If you're granting access to a specific role, ensure the ARN exactly matches the role's actual ARN, including the account ID and role name. Use the AWS Management Console or AWS CLI to verify the ARN: `aws iam get-role --role-name MyRole`.

**Forgot to Allow Your Own Account**: A common oversight when writing resource policies is forgetting to allow access from your own AWS account. If you're testing the API from within your own account, you must include that account's root or specific roles in the Allow statement. Otherwise, you'll lock yourself out.

**IP Address Condition Mismatch**: When using IP-based conditions, remember that the source IP is the IP seen by API Gateway. If your request passes through a proxy, load balancer, or NAT gateway, the source IP might not be what you expect. You can check the source IP in CloudTrail events or by inspecting the `x-forwarded-for` header in your Lambda function.

**VPC Endpoint Not Correctly Specified**: If you're using VPC endpoint conditions, verify that you're specifying the correct endpoint ID. VPC endpoint IDs start with `vpce-`. If the condition doesn't match, the request is denied.

**Resource ARN Mismatch**: Ensure the Resource ARN in your policy matches the actual API. A common mistake is using the wrong API ID or stage name. The resource ARN should match the format `arn:aws:execute-api:region:account-id:api-id/stage/method/path`.

To troubleshoot, enable CloudTrail logging for your API Gateway API. CloudTrail logs include the policy evaluation details, showing whether the resource policy allowed or denied the request and why. You can also use AWS CloudWatch Logs by enabling execution logs on your API stage, which will show the authorization context.

If you suspect the issue is with conditions, try temporarily removing conditions and using a simple Allow statement to verify the principal is correct. Then gradually add conditions back to isolate which one is causing the denial.

### Best Practices for API Gateway Resource Policies

When implementing resource policies for API Gateway, follow these guidelines:

**Principle of Least Privilege**: Grant the minimum permissions necessary. If only a specific role needs access, specify that role rather than the entire account root. If only specific IP ranges should access the API, specify those ranges rather than allowing all IPs.

**Use Explicit Denies Sparingly**: While explicit denies are powerful, they're difficult to manage at scale. Prefer explicit allows with implicit denies for most use cases. Use explicit denies only for specific cases where you want to block certain principals despite other policies allowing them.

**Document Your Intent**: Include comments in your policy explaining why certain accounts, roles, or IP ranges are allowed or denied. This helps future maintainers understand the security architecture.

**Test Before Deployment**: Before applying a resource policy to your production API, test it thoroughly in a development or staging environment. Try requests from allowed and denied sources to verify the policy works as intended.

**Monitor and Audit**: Set up CloudTrail logging to audit which requests are allowed and denied by your resource policy. Regularly review these logs to detect unexpected access patterns or misconfigurations.

**Avoid Overly Complex Conditions**: While it's tempting to add many conditions, complex policies become harder to understand and maintain. If a policy requires more than three or four conditions, consider whether you can simplify the access model or use multiple statements.

### Attaching and Managing Resource Policies

You can attach a resource policy to an API Gateway API using the AWS Management Console, AWS CLI, or Infrastructure as Code tools like AWS CloudFormation or Terraform.

Using the AWS CLI, you can attach a policy with:

```bash
aws apigateway put-rest-api-policy \
  --rest-api-id abcdef1234 \
  --policy file://policy.json
```

Replace `abcdef1234` with your API ID and `policy.json` with your policy file. To retrieve the current policy:

```bash
aws apigateway get-rest-api-policy \
  --rest-api-id abcdef1234
```

To remove a policy:

```bash
aws apigateway delete-rest-api-policy \
  --rest-api-id abcdef1234
```

In CloudFormation, you can attach a resource policy using the `AWS::ApiGateway::RestApi` resource with the `Policy` property:

```yaml
MyApi:
  Type: AWS::ApiGateway::RestApi
  Properties:
    Name: MyApi
    Policy:
      Version: "2012-10-17"
      Statement:
        - Effect: Allow
          Principal: "*"
          Action: execute-api:Invoke
          Resource: "*"
          Condition:
            IpAddress:
              aws:SourceIp:
                - 203.0.113.0/24
```

This approach allows you to version-control your API policies alongside your infrastructure code.

### Advanced Scenarios: Combining Multiple Conditions

For sophisticated security requirements, you can combine multiple conditions in a single statement. For example, you might want to allow an external partner to access your API, but only from their corporate network:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::999888777666:root"
      },
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:us-east-1:123456789012:abcdef1234/*/*/*",
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": "192.0.2.0/24"
        },
        "StringEquals": {
          "aws:SourceVpc": "vpc-partner123"
        }
      }
    }
  ]
}
```

This statement requires *both* conditions to be true: the request must come from the partner account AND from the specified IP range AND from the specified VPC. (Note: In this case, the VPC condition might be redundant if the IP range already guarantees the network source, but it demonstrates how multiple conditions work together.)

When multiple conditions are present, they're combined with an AND operator—all conditions must be satisfied for the statement to apply.

### Conclusion

Resource policies for API Gateway provide a powerful mechanism for controlling access at the perimeter of your APIs. By understanding how to write and deploy these policies, you can enforce security boundaries based on AWS accounts, IP addresses, VPC endpoints, and custom conditions. Combined with method-level authorization mechanisms like Lambda authorizers and IAM roles, resource policies create a defense-in-depth security posture.

Whether you're building internal APIs restricted to corporate networks, enabling cross-account access for partners, or implementing complex multi-account architectures, resource policies give you fine-grained control without requiring changes to your backend logic. The key is understanding the evaluation order, testing thoroughly, and monitoring your access patterns over time. With the patterns and examples provided in this article, you're well-equipped to implement resource policies that meet your organization's security requirements.
