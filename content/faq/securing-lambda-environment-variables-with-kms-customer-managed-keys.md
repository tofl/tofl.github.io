---
title: "Securing Lambda Environment Variables with KMS Customer-Managed Keys"
---

## Securing Lambda Environment Variables with KMS Customer-Managed Keys

AWS Lambda environment variables offer a convenient way to pass configuration into your functions without hardcoding values. But convenience and security aren't always natural companions. By default, Lambda stores environment variables in a way that feels secure but may not meet your compliance requirements. If you're handling sensitive data—API keys, database credentials, or customer identifiers—you need to understand how to encrypt these variables properly and maintain control over the encryption keys themselves.

This guide walks you through the practical reality of securing Lambda environment variables using AWS Key Management Service (KMS), from understanding the default encryption behavior to implementing customer-managed keys that give you compliance-grade control and auditability.

### Why Environment Variable Encryption Matters

When you create a Lambda function and add environment variables through the console or CLI, AWS encrypts them at rest automatically. That's the good news. The less obvious news is that AWS manages those encryption keys on your behalf using an AWS-owned key. For many use cases, this is perfectly adequate. But if your organization operates under strict compliance requirements—think PCI-DSS, HIPAA, or SOC 2—you likely need to manage your own encryption keys, rotate them on your schedule, and maintain a complete audit trail of who accessed what and when.

Environment variables are also different from truly secret values. They're typically used for configuration: database hostnames, feature flags, service endpoints, or non-sensitive metadata. Secrets—the actual credentials, API keys, and passwords—belong in AWS Secrets Manager or a similar dedicated service. Confusing the two is a common mistake that can undermine your entire security posture.

### Understanding Default Encryption with AWS-Managed Keys

By default, when you create a Lambda function and add environment variables, AWS encrypts them using a KMS key owned and managed by AWS. You don't see this key in your AWS account, you can't control its rotation schedule, and you can't audit exactly who accessed it. From AWS's perspective, this approach is convenient and secure enough for development and many production workloads.

The encryption happens transparently. Lambda automatically decrypts the variables before passing them to your function code. In your handler, you simply read from `process.env` (Node.js), `os.environ` (Python), or the equivalent in your runtime, and you get the plaintext value. You never have to think about KMS or decryption—it just works.

However, this convenience comes at the cost of visibility and control. If an auditor asks, "Show me all the times someone accessed the encryption key protecting this Lambda's secrets," you can't produce that audit trail because you don't own the key. For regulated industries, that's often a dealbreaker.

### Switching to Customer-Managed Keys

To take ownership of encryption, you create a customer-managed KMS key in your AWS account and configure Lambda to use it instead of the AWS-managed alternative. This involves three main steps: creating the key, configuring Lambda to use it, and ensuring the right IAM permissions are in place.

#### Creating Your KMS Key

Start by creating a customer-managed KMS key. You can do this through the AWS Management Console or with the AWS CLI:

```bash
aws kms create-key \
  --description "KMS key for Lambda environment variables" \
  --key-usage ENCRYPT_DECRYPT \
  --origin AWS_KMS
```

This command creates a new key and returns a key ID and ARN. Keep the ARN handy; you'll need it shortly. Optionally, create an alias to make the key easier to reference:

```bash
aws kms create-alias \
  --alias-name alias/lambda-env-vars \
  --target-key-id <key-id>
```

An alias like `alias/lambda-env-vars` is far more memorable and readable than a raw key ID, especially when you're managing multiple keys across your infrastructure.

#### Configuring Lambda to Use the Customer-Managed Key

With your key created, you now tell Lambda to use it for encrypting environment variables. In the AWS Console, navigate to your Lambda function, locate the "Environment variables" section, and look for an "Encryption configuration" option. There, you'll select your customer-managed key by its ARN or alias.

Via the CLI, you'd use the `update-function-configuration` command:

```bash
aws lambda update-function-configuration \
  --function-name my-function \
  --kms-key-arn arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012
```

Or, more conveniently with an alias:

```bash
aws lambda update-function-configuration \
  --function-name my-function \
  --kms-key-arn arn:aws:kms:us-east-1:123456789012:alias/lambda-env-vars
```

After this change, Lambda uses your customer-managed key to encrypt any new or updated environment variables. Existing variables aren't automatically re-encrypted; you'll need to update them to trigger re-encryption with the new key.

### Understanding the Encryption Helpers Feature

Lambda offers a useful but often misunderstood feature: encryption helpers for client-side encryption of specific environment variable values. This is relevant when you want to manage the encryption and decryption of individual variables within your function code, rather than relying entirely on Lambda's automatic decryption.

The encryption helpers are language-specific utilities that you can reference when creating environment variables through the console. When you check the "Encrypt this value" checkbox next to an environment variable in the Lambda console, the helper encrypts that specific value for you before you even set it. The encrypted blob is then stored as the variable's value.

In your function code, you manually decrypt this value using the KMS Decrypt API. This gives you fine-grained control: some variables might remain plaintext (configuration that doesn't need encryption), while others are encrypted and decrypted only when your handler actually needs them.

For example, if you're using Python, your handler might look like this:

```python
import boto3
import json
import base64

kms_client = boto3.client('kms')

def lambda_handler(event, context):
    encrypted_api_key = os.environ['ENCRYPTED_API_KEY']
    
    # Decrypt the value using KMS
    response = kms_client.decrypt(CiphertextBlob=base64.b64decode(encrypted_api_key))
    api_key = response['Plaintext'].decode('utf-8')
    
    # Now use the decrypted API key
    return {
        'statusCode': 200,
        'body': json.dumps('Request processed')
    }
```

In Node.js, the pattern is similar:

```javascript
const AWS = require('aws-sdk');
const kms = new AWS.KMS();

exports.handler = async (event) => {
    const encryptedApiKey = process.env.ENCRYPTED_API_KEY;
    
    const params = {
        CiphertextBlob: Buffer.from(encryptedApiKey, 'base64')
    };
    
    const data = await kms.decrypt(params).promise();
    const apiKey = data.Plaintext.toString('utf-8');
    
    return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Request processed' })
    };
};
```

The benefit of this approach is that sensitive values are encrypted at rest and remain encrypted until your code explicitly decrypts them. It also allows you to use different KMS keys for different variables if your compliance framework requires it.

However, it's important to note that once Lambda has decrypted the variable (whether automatically or through your manual KMS call), the plaintext value sits in your function's memory. This is unavoidable; your code needs to work with the actual secret. The encryption protects the value in transit and at rest, but not while it's in use.

### IAM Permissions for KMS Decryption

For Lambda to decrypt environment variables encrypted with a customer-managed key, the function's execution role must have permissions to call the KMS Decrypt API. Without these permissions, your function will fail at runtime when it tries to access the encrypted variables.

The IAM policy for your Lambda execution role should include:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "kms:Decrypt",
                "kms:DescribeKey"
            ],
            "Resource": "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012"
        }
    ]
}
```

If you're using the encryption helpers (client-side decryption in your code), you need the same permissions. If you're doing manual decryption with the KMS API, ensure the `kms:Decrypt` action is included.

Additionally, the KMS key's resource-based policy (the key policy) must allow the Lambda execution role to decrypt. By default, when you attach an IAM policy to a role, that should be sufficient if the key policy allows IAM policies to govern access. However, if you've customized the key policy, you may need to explicitly add a statement allowing the role's ARN to decrypt with this key.

A minimal key policy statement might look like:

```json
{
    "Sid": "Allow Lambda execution role to decrypt",
    "Effect": "Allow",
    "Principal": {
        "AWS": "arn:aws:iam::123456789012:role/lambda-execution-role"
    },
    "Action": [
        "kms:Decrypt",
        "kms:DescribeKey"
    ],
    "Resource": "*"
}
```

### Separating Configuration from Secrets

A critical best practice is understanding the distinction between configuration and secrets, and using the right service for each.

**Configuration** includes things like feature flags, database hostnames, log levels, API endpoints, and other non-sensitive metadata that typically don't need to be rotated or heavily guarded. Lambda environment variables are ideal for configuration. They're simple, available immediately in your function, and don't require API calls to retrieve.

**Secrets** are things like database passwords, API keys, authentication tokens, and any other credential that could compromise your system if exposed. Secrets should live in AWS Secrets Manager, Parameter Store (with SecureString type), or a dedicated secrets management service. These systems offer rotation, versioning, and better auditing than environment variables alone.

A common mistake is storing everything in environment variables and calling it secure because you've encrypted them with KMS. While KMS encryption is an important layer, it's not a substitute for a proper secrets management solution. Secrets Manager, for instance, provides automatic rotation of credentials, better integration with other AWS services, and compliance-specific features that environment variables simply don't have.

A well-architected approach might look like this: use Lambda environment variables for your database hostname and log level, but fetch your database password from Secrets Manager at runtime. This separates concerns, keeps your secrets management explicit and auditable, and makes rotation straightforward.

### Audit and Compliance Considerations

One of the primary reasons to use customer-managed KMS keys is auditability. When you use a customer-managed key, every decrypt operation is logged to AWS CloudTrail. You can query CloudTrail to see exactly when someone (or some service) decrypted your Lambda's environment variables, from what IP, and using which role.

Enable CloudTrail logging for KMS if it isn't already:

```bash
aws cloudtrail start-logging --trail-name my-trail
```

Then, you can query CloudTrail for decrypt events:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=Decrypt \
  --max-results 10
```

This audit trail is essential for compliance frameworks. When an auditor asks, "Who accessed the encryption keys protecting production secrets?" you have a concrete, timestamped answer.

Additionally, customer-managed keys allow you to set key rotation policies. You can enable automatic annual rotation, or manage rotation manually if your compliance framework requires explicit approval. AWS-managed keys are rotated automatically by AWS, but you have no visibility into or control over the schedule.

### Handling Key Rotation

When you rotate your KMS key, you have two options: automatic rotation and manual rotation. Automatic rotation happens annually without intervention. Manual rotation gives you explicit control but requires you to set up a new key and update your resources to use it.

During rotation, old encrypted values remain valid. KMS maintains both the old and new key material, so Lambda can still decrypt environment variables that were encrypted with previous key versions. Your application doesn't need to change or redeploy.

If you need to rotate a customer-managed key manually, create a new key, update your Lambda function's KMS key configuration to point to the new one, and keep the old key around for decryption of historical data. Over time, you can retire old keys if compliance permits.

### Performance and Cost Implications

Using KMS encryption for Lambda environment variables has minimal performance impact. Lambda caches the decrypted variables in memory, so you're not decrypting them on every invocation. The decryption happens once, when the function starts up, and the plaintext is cached for the lifetime of the container.

From a cost perspective, each KMS Decrypt operation incurs a charge (though the first 20,000 API calls per month are free). Since Lambda caches the decrypted value, you're not paying per invocation; you're paying per cold start. For functions with infrequent cold starts or low invocation volume, the cost is negligible. For high-volume functions, the cost is still typically minimal compared to compute costs.

If cost becomes a concern, remember that not every environment variable needs to be encrypted. Plaintext configuration doesn't require KMS calls. Reserve encryption for genuinely sensitive values, and use plain environment variables for everything else.

### Common Pitfalls and How to Avoid Them

One frequent mistake is setting up customer-managed key encryption but forgetting to update the Lambda execution role's IAM policy. The function then fails at runtime when it tries to decrypt, with a cryptic KMS access denied error. Always test in a non-production environment first.

Another pitfall is confusing encryption at rest with encryption in transit. Encrypting an environment variable protects it while it's stored in the Lambda service, but once your code accesses it, it's plaintext in memory. This is by design and unavoidable, but it's important not to misrepresent the protection it provides.

Some developers also encrypt everything "just to be safe," even non-sensitive configuration. This adds complexity and operational overhead without security benefit. Be intentional about what you encrypt.

Finally, store your KMS key ARN or alias in a secure, documented location. Losing track of which key encrypts which function's variables makes key rotation and access audits much harder. Use tags, naming conventions, and documentation to keep this metadata organized.

### Conclusion

Securing Lambda environment variables with customer-managed KMS keys is a practical way to meet compliance requirements and maintain control over your encryption infrastructure. The process itself is straightforward: create a customer-managed key, point your Lambda function to it, ensure the execution role has decrypt permissions, and enable CloudTrail logging for auditability.

The key insight is that encryption of environment variables is a security control, but not a comprehensive secrets management strategy. Environment variables work well for configuration and moderately sensitive values, but true secrets belong in Secrets Manager. By understanding the distinction and using the right tool for each purpose, you build systems that are both secure and operationally maintainable.

Start by assessing what you're storing in environment variables today. Move genuine secrets to Secrets Manager, apply KMS encryption to remaining sensitive configuration, and leave plaintext configuration as-is. This layered approach gives you security where it matters without overcomplicating the systems you operate.
