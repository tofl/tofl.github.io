---
title: "AWS Encryption SDK vs KMS Direct API: Which to Use"
---

# AWS Encryption SDK vs KMS Direct API: Which to Use

When you need to encrypt data in AWS, you'll quickly discover that you have options. You can reach for the AWS Key Management Service directly through its straightforward Encrypt and Decrypt APIs, or you can layer in the AWS Encryption SDK, a client-side library that builds intelligent abstractions on top of KMS. The choice between these approaches profoundly affects your application's security posture, performance, and operational complexity. This article walks through both paths, explaining what each one does well and where each falls short, so you can make an informed decision for your use case.

### Understanding the KMS Encrypt and Decrypt APIs

The AWS Key Management Service provides a straightforward, low-level API for encryption operations. When you call the Encrypt API, you hand it plaintext data and a KMS key identifier, and KMS returns ciphertext. To decrypt, you pass the ciphertext back to the Decrypt API, and it returns the plaintext. Simple, direct, and effective for basic scenarios.

Here's what a basic KMS encryption flow looks like in practice:

```python
import boto3

client = boto3.client('kms')

plaintext = b'Hello, sensitive data!'
key_id = 'arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012'

# Encrypt
response = client.encrypt(KeyId=key_id, Plaintext=plaintext)
ciphertext = response['CiphertextBlob']

# Decrypt
response = client.decrypt(CiphertextBlob=ciphertext)
plaintext_recovered = response['Plaintext']
```

This approach works perfectly well for straightforward scenarios. You have complete control over when encryption and decryption happen. KMS handles the actual cryptographic operations server-side, which means your plaintext never leaves the AWS region where the key resides. The ciphertext includes metadata that KMS needs to decrypt it later, so you don't have to manage key IDs separately.

However, this direct approach has meaningful limitations once your application grows beyond trivial use cases. Every encryption and decryption operation makes a network round-trip to the KMS service. If you're encrypting individual fields in a database record or encrypting many small objects, these API calls accumulate quickly. KMS has rate limits—starting at 10,000 operations per second per account per region, though you can request increases—and you'll hit those limits far sooner than you might expect. Additionally, using KMS directly means your application must manage the complexity of encryption context, handle the logistics of working with multiple CMKs across regions, and implement retry logic and error handling on its own.

### Introducing the AWS Encryption SDK

The AWS Encryption SDK takes a different approach. Rather than calling KMS directly, your application uses the Encryption SDK library, which internally orchestrates KMS calls while handling several sophisticated patterns automatically. Think of it as middleware between your application and KMS—it abstracts away complexity and implements encryption best practices so you don't have to.

The fundamental architectural pattern that the Encryption SDK implements is called envelope encryption. Instead of encrypting your entire dataset directly with a KMS key, envelope encryption works like this: the SDK generates a temporary, random data key locally, uses that data key to encrypt your plaintext with a fast, symmetric algorithm like AES-256-GCM, and then sends that data key to KMS to be encrypted under your CMK. The result is a blob containing the KMS-encrypted data key plus the encrypted plaintext. When you decrypt, the SDK sends the encrypted data key to KMS, recovers the plaintext data key, and uses it to decrypt your data.

Why does this matter? Envelope encryption dramatically reduces the load on KMS. Instead of sending your entire 10 megabyte file to KMS for encryption, you send only a small data key—typically 32 bytes. The actual cryptographic heavy lifting for your large dataset happens locally using fast, symmetric algorithms. This approach scales far better, respects KMS rate limits more gracefully, and often costs less since KMS charges per API call.

Here's the equivalent operation using the Encryption SDK:

```python
from aws_encryption_sdk import KMSMasterKeyProvider, encrypt, decrypt

key_provider = KMSMasterKeyProvider(key_ids=[
    'arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012'
])

plaintext = b'Hello, sensitive data!'

# Encrypt
ciphertext, encryptor = encrypt(source=plaintext, key_provider=key_provider)

# Decrypt
plaintext_recovered, decryptor = decrypt(source=ciphertext, key_provider=key_provider)
```

On the surface, the API is similarly straightforward. But underneath, the SDK is doing substantially more intelligent work.

### Key Features That Differentiate the Encryption SDK

#### Data Key Caching

One of the most impactful features the Encryption SDK provides is data key caching. When you encrypt multiple pieces of data with the same master key, the SDK can reuse the same data key for a configurable period rather than requesting a new one from KMS for each encryption operation. This is a game-changer for performance and cost.

Imagine you're processing a batch of 10,000 log entries and encrypting each one. With direct KMS calls, you'd make 10,000 Encrypt API calls. With the Encryption SDK and data key caching enabled, you might make just one or two KMS calls to generate data keys, and the SDK uses cached keys for the rest. Your throughput improves dramatically, and your KMS API call count drops correspondingly.

Of course, caching introduces a security tradeoff. If a data key is cached and somehow compromised, it could decrypt all data encrypted with that key during the cache window. The SDK allows you to configure the cache duration and maximum amount of data encrypted with a single cached key, giving you fine-grained control over this balance.

```python
from aws_encryption_sdk import KMSMasterKeyProvider
from aws_encryption_sdk.key_providers.kms import KMSMasterKeyProvider
from aws_encryption_sdk.caches import LocalCache
from aws_encryption_sdk.structures import EncryptionContext

# Create a caching provider
cache = LocalCache(capacity=100)
key_provider = KMSMasterKeyProvider(key_ids=[
    'arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012'
])

# The cache is configured to hold up to 100 data keys
# Each cached key can encrypt up to 100 MB before being discarded
```

This kind of optimization is essentially impossible with the direct KMS API. You'd have to implement it yourself, managing key lifetimes and rotation logic in your application code.

#### Encryption Context

Encryption context is a feature present in KMS itself, but the Encryption SDK makes it far more practical and automatic. Encryption context is a set of key-value pairs that you associate with an encryption operation. KMS binds this context to the ciphertext, and during decryption, you must provide the same context—if you don't, decryption fails.

Encryption context serves two purposes. First, it's a security mechanism. If an attacker steals ciphertext intended for one purpose and tries to use it in another context, the decryption will fail because the context won't match. Second, it's an organizational tool. By using encryption context, you can document and enforce policies about what data can be decrypted in what situations.

With the Encryption SDK, adding encryption context to your operations is straightforward:

```python
from aws_encryption_sdk import KMSMasterKeyProvider, encrypt

key_provider = KMSMasterKeyProvider(key_ids=[
    'arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012'
])

plaintext = b'Sensitive customer data'
encryption_context = {
    'customer_id': '12345',
    'data_type': 'customer_profile',
    'purpose': 'backup'
}

ciphertext, encryptor = encrypt(
    source=plaintext,
    key_provider=key_provider,
    encryption_context=encryption_context
)

# Later, decryption requires the same context
plaintext_recovered, decryptor = decrypt(
    source=ciphertext,
    key_provider=key_provider,
    encryption_context=encryption_context
)
```

Using encryption context with the direct KMS API is certainly possible, but you have to pass it explicitly to every Encrypt and Decrypt call. You must manage it in your application logic and ensure it's consistent everywhere. The Encryption SDK integrates context management more naturally into its workflow.

#### Multi-Region and Multi-CMK Support

Many enterprises operate across multiple AWS regions and use different CMKs in each region for compliance or operational reasons. Managing this with direct KMS API calls becomes tedious. You need to determine which region a piece of data is in, route encryption calls to the appropriate region's KMS endpoint, and handle the logistics of CMK failover or replication.

The Encryption SDK's multi-key provider feature handles this elegantly. You can provide it with a list of CMKs across different regions, and the SDK will encrypt the data under all of them. The resulting ciphertext can be decrypted by any of those keys—whichever region or KMS endpoint is available becomes the decryption path.

```python
from aws_encryption_sdk import KMSMasterKeyProvider

# Specify CMKs in multiple regions
key_provider = KMSMasterKeyProvider(key_ids=[
    'arn:aws:kms:us-east-1:123456789012:key/primary-key-id',
    'arn:aws:kms:eu-west-1:123456789012:key/replica-key-id'
])

# The SDK encrypts under both keys
ciphertext, encryptor = encrypt(source=plaintext, key_provider=key_provider)

# Decryption can use either key, making this region-resilient
plaintext_recovered, decryptor = decrypt(source=ciphertext, key_provider=key_provider)
```

This is a significant operational advantage if you're building applications that span regions or need to handle CMK rotations gracefully without service disruption.

#### Automated Data Key Generation and Rotation

The Encryption SDK manages data key generation and rotation automatically according to your configured policies. You don't manually call out to KMS to generate keys—the SDK does it for you based on cache settings and time-based policies. This reduces the chances of implementation mistakes and ensures your encryption keys are rotated consistently.

### Performance Implications: The Real-World Impact

The performance difference between direct KMS calls and the Encryption SDK becomes apparent once you move beyond trivial workloads. Let's consider a concrete scenario: encrypting 1,000 small objects (say, 1 KB each) without any caching.

With direct KMS API calls, you make 1,000 Encrypt requests to KMS. At typical network latency and KMS service latency, this might take 10-15 seconds or more, depending on your network conditions and current KMS load.

With the Encryption SDK and data key caching enabled, you might make just 1-2 KMS requests to generate data keys, and the SDK performs the remaining 998-999 encryptions locally. The same operation might complete in 100-200 milliseconds. That's not a small difference—it's often a 50-100x improvement.

The cost difference is similarly striking. If you're operating under KMS's free tier (20,000 requests per month), direct API calls will exhaust it quickly. The Encryption SDK's approach means you're paying for KMS calls proportional to how many unique data keys you generate, not how much data you encrypt.

### When to Use Direct KMS API Calls

Despite the advantages of the Encryption SDK, there are legitimate scenarios where direct KMS API calls make sense.

If your application encrypts data very infrequently—perhaps once per hour or less—the overhead of the Encryption SDK library and the complexity of managing data key caching might outweigh the benefits. A single KMS Encrypt call is straightforward and low-latency, and you're not going to hit any rate limits.

If you're building a microservice that acts purely as a KMS proxy or you're implementing a system where you want explicit, fine-grained control over every encryption operation without any abstraction, direct API calls give you that clarity. Some compliance or security auditing regimes require this level of explicit control.

If you're working with a runtime environment where the Encryption SDK library isn't available or would be difficult to deploy, direct API calls become the only option. The Encryption SDK is available for Python, Java, JavaScript, and Go—but if you're using another language, KMS API calls might be your only choice.

Additionally, if you need very specialized encryption behavior that the Encryption SDK doesn't support—though this is rare—you might need to implement your own envelope encryption using direct KMS calls and handle the data key management yourself.

### When to Use the AWS Encryption SDK

For the majority of production applications handling sensitive data, the Encryption SDK is the better choice. If your application encrypts more than trivial amounts of data, especially if those operations happen frequently or in batches, the Encryption SDK's combination of performance, cost efficiency, and reduced operational burden makes it worth adopting.

The Encryption SDK particularly shines when you're building systems that need to operate across multiple regions, multiple CMKs, or where you want encryption context and policy enforcement built into the encryption layer itself rather than bolted on at the application level.

If you're building something that stores encrypted data long-term—in a database, object storage, or any durable location—the Encryption SDK's structured ciphertext format (which includes metadata about how to decrypt it) is significantly more maintainable than implementing your own encryption format on top of direct KMS calls.

### A More Complete Example

Let's look at a more realistic scenario: an application that stores encrypted customer records in DynamoDB. Here's how you might implement this using the Encryption SDK:

```python
import boto3
import json
from aws_encryption_sdk import KMSMasterKeyProvider, encrypt, decrypt

class CustomerStore:
    def __init__(self, table_name, kms_key_ids):
        self.dynamodb = boto3.resource('dynamodb')
        self.table = self.dynamodb.Table(table_name)
        
        self.key_provider = KMSMasterKeyProvider(key_ids=kms_key_ids)
    
    def store_customer(self, customer_id, customer_data):
        """Store encrypted customer data in DynamoDB"""
        
        # Prepare encryption context
        encryption_context = {
            'customer_id': customer_id,
            'data_type': 'customer_record',
            'purpose': 'storage'
        }
        
        # Serialize customer data
        plaintext = json.dumps(customer_data).encode('utf-8')
        
        # Encrypt using the SDK
        ciphertext, encryptor = encrypt(
            source=plaintext,
            key_provider=self.key_provider,
            encryption_context=encryption_context
        )
        
        # Store in DynamoDB
        self.table.put_item(
            Item={
                'customer_id': customer_id,
                'encrypted_data': ciphertext,
                'encrypted_by': 'encryption_sdk'
            }
        )
    
    def retrieve_customer(self, customer_id):
        """Retrieve and decrypt customer data"""
        
        response = self.table.get_item(Key={'customer_id': customer_id})
        encrypted_data = response['Item']['encrypted_data']
        
        # Prepare the same encryption context used during encryption
        encryption_context = {
            'customer_id': customer_id,
            'data_type': 'customer_record',
            'purpose': 'storage'
        }
        
        # Decrypt using the SDK
        plaintext, decryptor = decrypt(
            source=encrypted_data,
            key_provider=self.key_provider,
            encryption_context=encryption_context
        )
        
        return json.loads(plaintext.decode('utf-8'))
```

This approach is elegant because the encryption and decryption logic is isolated, the encryption context is explicit and enforced, and if you later decide to use data key caching or expand to multiple regions, you can add those features without restructuring your application code.

### The Operational Perspective

From an operational standpoint, the Encryption SDK reduces your ongoing maintenance burden. You're not implementing custom key rotation logic, managing data key lifecycles, or debugging encryption-related issues in your own code. AWS maintains the SDK, tests it against security best practices, and updates it when new patterns or vulnerabilities emerge. You're leveraging AWS's expertise rather than having to build and maintain that expertise yourself.

That said, the Encryption SDK does introduce a dependency. You need to understand how it works, keep it updated, and be aware of any behavior changes between versions. For some teams, especially those with extensive custom encryption infrastructure already in place, this might represent additional operational overhead rather than a reduction.

### Making Your Decision

The choice between direct KMS calls and the Encryption SDK isn't one-size-fits-all, but the decision tree is fairly straightforward. Start with the Encryption SDK if your application encrypts data frequently, operates at scale, spans multiple regions, or needs sophisticated encryption context enforcement. Direct KMS API calls make sense for occasional encryption operations, specialized use cases, or when you're implementing custom encryption architectures that the SDK doesn't fit.

In practice, many organizations end up using both: the Encryption SDK for application-level encryption of business data, and direct KMS API calls for highly specialized use cases or systems where the SDK doesn't fit. The important thing is understanding what each approach offers and where its strengths and limitations lie.
