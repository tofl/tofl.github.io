---
title: "28. KMS"
type: docs
weight: 1
---

# KMS (Key Management Service) — Deep Dive

AWS Key Management Service (KMS) is a managed service that lets you create, control, and use cryptographic keys to protect your data. Its core purpose is simple: rather than managing raw encryption keys yourself — which is error-prone and operationally burdensome — KMS centralises key management, enforces access control via IAM and key policies, and maintains an audit trail through CloudTrail. Every call to KMS is logged, which makes it the default choice for encryption across nearly every AWS service.

By this point in the course you have already encountered KMS in several contexts: SSE-KMS in S3, DynamoDB encryption at rest, SQS message encryption, and Lambda environment variable encryption. This section pulls all of that together and fills in the underlying mechanics.

## Envelope Encryption — The Core Pattern

KMS does not encrypt your data directly in most real-world scenarios. Instead, it uses **envelope encryption** [🔗](https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html#enveloping), a two-layer pattern:

1. KMS generates a **Data Encryption Key (DEK)** — a short-lived symmetric key used to encrypt your actual data locally.
2. KMS then encrypts the DEK itself using your **KMS key** (the root key, which never leaves KMS).
3. The encrypted DEK is stored alongside the ciphertext. The plaintext DEK is discarded immediately after use.

To decrypt, the process reverses: KMS decrypts the encrypted DEK using the KMS key, and your application uses the plaintext DEK to decrypt the data locally.

This pattern explains why KMS can protect arbitrarily large payloads without sending them to the KMS API — only the small DEK crosses the wire. It also explains the cost model: you pay per KMS API call (GenerateDataKey, Decrypt), not per byte of data encrypted.

**How this maps to services you have already seen:**

- **S3 with SSE-KMS** — When you upload an object, S3 calls `GenerateDataKey` on your behalf, encrypts the object locally with the DEK, stores the encrypted DEK in object metadata, and discards the plaintext DEK. On download, S3 calls `Decrypt` to recover the DEK. This is why SSE-KMS has a cost and a KMS API rate limit consideration that SSE-S3 does not.
- **DynamoDB** — Encryption at rest uses a table-level KMS key. DynamoDB manages the DEK lifecycle internally; you choose the key (AWS-owned, AWS-managed, or customer-managed).
- **SQS** — Server-side encryption for queues follows the same pattern. Each message batch is encrypted with a DEK derived from the queue's KMS key.
- **Lambda environment variables** — Lambda encrypts environment variables at rest using a KMS key. You can bring your own CMK for additional control over key rotation and access.

## KMS Key Types

KMS keys differ along two axes — who creates them and who manages them [🔗](https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html#key-mgmt):

- **AWS-owned keys** — Created and managed entirely by AWS, used internally by services like S3 (SSE-S3) and DynamoDB (AWS-owned option). You have no visibility or control, and they appear in no key list in your account.
- **AWS-managed keys** — Created in your account automatically when you first enable encryption for a service (e.g., `aws/s3`, `aws/lambda`). You can see them in the KMS console and view CloudTrail logs, but you cannot rotate, delete, or modify their key policies.
- **Customer-managed keys (CMKs)** — Keys you create explicitly. These give you full control: custom key policies, manual or automatic annual rotation, grants, cross-account access, and the ability to disable or schedule deletion. CMKs are what you use when compliance, auditability, or cross-account sharing is a requirement.

For the exam, the practical distinction is: **CMKs are required whenever you need to share encrypted resources across accounts, enforce fine-grained key policies, or control rotation yourself.**

## Key Policies and Access Control

Every KMS key has a **key policy** — a resource-based policy that is the primary access control mechanism [🔗](https://docs.aws.amazon.com/kms/latest/developerguide/key-policies.html). Unlike most AWS resources where IAM policies alone suffice, KMS requires that the key policy explicitly allows access. IAM policies alone are not sufficient unless the key policy delegates trust to the account's IAM system.

The default key policy when you create a CMK grants the root account full access and allows IAM policies to control access further. A common exam scenario: a developer cannot use a CMK even with the correct IAM permissions — the fix is to check whether the key policy grants their principal (or their role) access.

**Grants** are an alternative mechanism [🔗](https://docs.aws.amazon.com/kms/latest/developerguide/grants.html) — programmatic, temporary delegations of key permissions. AWS services like EBS and RDS use grants internally when they need to use your CMK on your behalf.

## Automatic Key Rotation

For CMKs, you can enable **automatic rotation** [🔗](https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html), which causes KMS to generate new cryptographic material every year while retaining the old material to decrypt data encrypted under previous versions. The key ID and ARN do not change, so no application changes are needed. AWS-managed keys rotate automatically every year; you cannot disable this.

## CloudHSM — Dedicated Hardware Security Modules

AWS CloudHSM [🔗](https://docs.aws.amazon.com/cloudhsm/latest/userguide/introduction.html) provides **dedicated, single-tenant hardware security modules** running in your VPC. The fundamental difference from KMS is the tenancy model and the compliance level:

| | KMS | CloudHSM |
|---|---|---|
| Hardware tenancy | Shared (multi-tenant) | Dedicated (single-tenant) |
| FIPS 140-2 level | Level 2 (overall) | **Level 3** |
| Key ownership | AWS manages the HSM; you manage the keys | You manage both the HSM and the keys |
| Integration | Native to almost all AWS services | Manual — you integrate via PKCS#11, JCE, or Microsoft CNG |
| Pricing model | Per API call | Per HSM-hour (plus cluster overhead) |
| Operational burden | Low — fully managed | High — you are responsible for HA clustering, backups |

**When to choose CloudHSM:** regulatory requirements that mandate FIPS 140-2 Level 3, use cases that require you to control the HSM's root of trust entirely (AWS has no access to CloudHSM keys), or workloads that need to use industry-standard cryptographic APIs (PKCS#11) rather than the KMS API.

**When to choose KMS:** virtually everything else. KMS is sufficient for most compliance frameworks, integrates natively with AWS services, and requires no operational management. For the exam, CloudHSM appears mostly in scenarios that explicitly mention FIPS 140-2 Level 3, dedicated hardware, or customer-controlled HSM credentials.

Note that KMS and CloudHSM are not mutually exclusive — you can configure a KMS **custom key store** [🔗](https://docs.aws.amazon.com/kms/latest/developerguide/custom-key-store-overview.html) backed by a CloudHSM cluster, which lets you use the familiar KMS API while keeping key material in your dedicated HSM.