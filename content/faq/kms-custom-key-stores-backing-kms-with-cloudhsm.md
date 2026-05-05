---
title: "KMS Custom Key Stores: Backing KMS with CloudHSM"
---

## KMS Custom Key Stores: Backing KMS with CloudHSM

Imagine you're building a system that needs the simplicity and power of AWS Key Management Service, but your compliance requirements demand that the actual key material never leave hardware under your exclusive control. Or perhaps your organization requires a Hardware Security Module to be present for regulatory reasons. This is where KMS custom key stores enter the picture, and they're one of those AWS features that solves a genuinely difficult problem in a remarkably elegant way.

KMS custom key stores let you combine the best of two worlds: the developer-friendly API and integration points of AWS KMS with the security guarantees and control of AWS CloudHSM. Rather than trusting AWS to manage your key material in their HSMs, you provision and operate your own CloudHSM cluster, and KMS uses it as the backing store for your keys. The result is a hybrid approach that gives you cryptographic control without sacrificing operational convenience.

This is an advanced topic, but one worth understanding thoroughly. Let's explore when this architecture makes sense, how to set it up, what it costs you operationally, and how it compares to the alternatives.

### Understanding the Landscape: KMS Keys and Their Storage

To appreciate what custom key stores solve, it helps to first understand the standard KMS architecture. When you create a KMS key in the normal way, AWS generates and stores your key material in CloudHSM clusters that AWS operates and manages. These are highly available, replicated across multiple physical locations, and protected by multiple layers of security. For most use cases, this arrangement is excellent. AWS manages the infrastructure, you get the benefit of AWS's HSMs, and you pay per operation rather than for dedicated hardware.

But this model has a fundamental limitation: AWS has access to the HSM infrastructure holding your keys. In many regulated industries—financial services, healthcare, government—this is unacceptable. Regulations may explicitly require that only you, the customer, have access to key material. PCI DSS, HIPAA, FIPS 140-2 compliance at certain levels, and various government standards can all drive this requirement. Additionally, some organizations simply have a philosophical or contractual obligation to maintain exclusive control over encryption keys, regardless of how trustworthy AWS might be.

This is where CloudHSM comes in. CloudHSM is a service where AWS provisions a physical Hardware Security Module in your AWS region, connected to your VPC over a private network. You own and operate it. AWS can't access its contents. You control the HSM firmware, the policies, the key material—everything.

KMS custom key stores bridge these two worlds. You provision a CloudHSM cluster, create a custom key store in KMS that points to it, and then create KMS keys stored in that custom key store. From your application's perspective, everything looks like a normal KMS key: you use the same API, the same IAM policies, the same integration with other AWS services. But underneath, the key material lives in your CloudHSM cluster, under your control.

### When Custom Key Stores Make Sense

Custom key stores aren't a default choice—they should be adopted when specific requirements push you toward them. The primary driver is regulatory or contractual compliance. If you operate in financial services and need to satisfy PCI DSS requirements for key management, if you handle protected health information and must comply with HIPAA's key management standards, or if you're subject to government regulations that demand customer-exclusive control of cryptographic keys, then custom key stores become necessary rather than optional.

Beyond compliance, there's the question of control and visibility. With a custom key store, you have complete operational visibility into the HSM. You can audit its logs, review its configurations, and make policy decisions about who can access it. Some organizations simply feel more comfortable when they have direct hands-on control over the hardware protecting their most sensitive data.

There's also a scenario where custom key stores are valuable for regulatory audits and sign-offs. When an auditor asks, "Where is this key material stored and who has access to it?", you can point to your CloudHSM cluster in your VPC, show the audit logs, and definitively answer the question without depending on AWS's representations.

However, if you don't have these drivers, standard KMS keys are almost certainly the better choice. They're cheaper, require less operational overhead, and benefit from AWS's infrastructure expertise.

### Architectural Overview of Custom Key Stores

Understanding how custom key stores work is essential for operating them effectively. When you create a custom key store, you're essentially telling KMS: "When I ask you to use keys stored in this custom key store, go talk to this specific CloudHSM cluster and perform cryptographic operations there."

The architecture involves several components working in concert. Your CloudHSM cluster runs in your VPC, connected via a private network. KMS has a logical entity called the KMS key store that references this HSM. When you create a KMS key and specify it should be stored in that custom key store, the key material is generated inside the CloudHSM cluster and never leaves it. All cryptographic operations—encryption, decryption, signing, verification—happen within the HSM itself.

The critical security property here is that the key material never transits the network in plaintext. When KMS needs to perform a cryptographic operation using a key stored in your custom key store, it communicates with the HSM in a way that keeps the key material inside the hardware. From KMS's perspective, it's working with a cryptographic service; from your perspective, that service is your own CloudHSM cluster.

This means the security boundary is clear. Your CloudHSM cluster is entirely within your control. Network access to it goes through your VPC. AWS infrastructure cannot access the key material. You can inspect the HSM's audit logs to see exactly what happened with your keys. This level of control is what makes custom key stores valuable in regulated environments.

### Setting Up a Custom Key Store

Creating a custom key store requires careful planning and several sequential steps. Let's walk through the process.

**Provisioning the CloudHSM cluster** is the first step. You'll need to decide on the cluster size, the regions where you want redundancy, and the HSM model. CloudHSM clusters must have at least two HSMs to be production-ready (for high availability), though you can start with one for development. Each HSM in the cluster contains identical key material and can perform cryptographic operations independently.

Once your CloudHSM cluster is running, you need to initialize it. This involves setting an administrator password and configuring the HSM's policies. CloudHSM uses a token-based authentication model; you'll be working with hardware security modules that authenticate through cryptographic tokens.

Next, you create a custom key store in KMS. You'll use the AWS Management Console or the KMS API to specify that this custom key store should use your CloudHSM cluster. During this process, you provide the cluster ID and authenticate with the HSM. KMS will verify that it can communicate with the cluster and establish a trust relationship.

Then comes the critical step: creating KMS keys in that custom key store. Unlike standard KMS keys, which AWS generates and manages, keys in a custom key store are generated inside your CloudHSM cluster. You specify that a newly created KMS key should be stored in your custom key store, and the key material is generated there, never leaving the HSM.

Let me illustrate with a practical example. Suppose you've already provisioned a CloudHSM cluster. You'd create a custom key store like this:

```bash
aws kms create-custom-key-store \
  --custom-key-store-name "my-regulated-keystore" \
  --cloud-hsm-cluster-id "cluster-abc123def456" \
  --key-store-password "HSMAdminPassword123"
```

Once created and connected, you'd then create a KMS key in that custom key store:

```bash
aws kms create-key \
  --description "Encryption key for payment processing" \
  --custom-key-store-id "cks-1a2b3c4d5e6f7g8h9"
```

Now when you use this key for encryption or decryption through the KMS API, the cryptographic operations happen inside your CloudHSM cluster.

### Operational Responsibilities and Management

This is where the trade-off becomes real. By bringing your CloudHSM cluster into the picture, you're assuming significant operational responsibilities that AWS handles for you with standard KMS keys.

**High availability becomes your responsibility.** A single CloudHSM is a single point of failure. For production workloads, you need to provision multiple HSMs in a cluster. This increases cost and complexity, but it's essential. If your HSM fails and you haven't configured redundancy, your custom key store becomes unavailable, and you can't decrypt data encrypted with those keys. This is a serious consideration.

**Capacity planning is now something you must do.** Standard KMS keys can handle essentially unlimited requests; AWS scales the underlying infrastructure transparently. CloudHSM has throughput limits based on the number of HSMs in your cluster. If you have only two HSMs and they're operating at capacity, you'll experience performance degradation. You need to monitor utilization, plan for growth, and add HSMs as needed.

**Backup and disaster recovery are critical.** You're responsible for backing up your CloudHSM cluster. Without proper backups, you could lose access to your key material. AWS provides tools for this—you can create backups of your cluster and restore them in other regions. But planning and executing these backups is your job.

**Access control and password management require diligence.** The HSM requires passwords for administrative access. You need to manage these credentials securely, rotate them regularly, and ensure that the right people have access without compromising security. Many organizations use AWS Secrets Manager or similar tools to manage HSM credentials.

**Monitoring and alerting are essential.** You need to watch your HSM cluster for errors, capacity issues, or unusual activity. CloudWatch metrics can help, but you should also be reviewing HSM audit logs regularly. If an HSM fails, you need to know about it immediately, not days later.

**Software updates and maintenance windows.** AWS manages CloudHSM firmware and software, but you're responsible for testing updates in your environment and scheduling maintenance windows. This is different from standard KMS, where AWS handles updates transparently.

The operational overhead is real, but for organizations with compliance requirements, it's often a necessary cost of doing business.

### Using Custom Key Store Keys in Your Applications

Once you have keys in a custom key store, using them is remarkably similar to using standard KMS keys. Your application code doesn't need to know the difference. You call the same KMS APIs—`Encrypt`, `Decrypt`, `GenerateDataKey`—and specify the KMS key ID or ARN. The fact that the key is stored in your CloudHSM cluster is an implementation detail.

```bash
# Encrypting data with a custom key store key
aws kms encrypt \
  --key-id "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012" \
  --plaintext "sensitive data here"
```

The response includes ciphertext, just as it would with a standard KMS key. When you decrypt it later:

```bash
aws kms decrypt \
  --ciphertext-blob fileb://encrypted-data.bin
```

KMS routes the request to your CloudHSM cluster, the decryption happens there, and you get the plaintext back. From your application's perspective, it's seamless.

However, there are a few operational considerations. First, the custom key store must be connected. If the CloudHSM cluster is unreachable or unavailable, KMS operations against keys in that custom key store will fail. This is why high availability is so critical. Second, performance may be slightly different than with standard KMS keys, depending on your HSM capacity and network latency. It's worth testing under realistic load conditions.

### Integration with AWS Services

One of the powerful aspects of KMS custom key stores is that many AWS services can use them for encryption. If you have an RDS database, you can encrypt it with a key from your custom key store. DynamoDB tables can be encrypted with custom key store keys. EBS volumes, S3 buckets, and many other services support customer-managed KMS keys, including those in custom key stores.

However, there's an important limitation: not all AWS services support custom key store keys. Some services, particularly newer ones or those with specific architectural requirements, only work with standard KMS keys. Before designing your encryption strategy around a particular service, verify that it explicitly supports customer-managed KMS keys in custom key stores. The AWS documentation for each service will specify this.

This integration capability is valuable because it means you can extend your compliance and control requirements across your entire AWS infrastructure, not just within your application code. Your data at rest, whether in databases or storage services, can be protected by keys you control exclusively.

### Cost Considerations

Let's talk about the financial reality. CloudHSM costs more than standard KMS, both in terms of infrastructure and operations. Each HSM in your cluster costs a fixed hourly fee. If you need a three-HSM cluster for high availability across regions, you're paying for all three continuously. There are also data transfer costs, and backup storage costs.

Standard KMS charges per API request, so you only pay for the operations you perform. If you have sporadic usage, this can be significantly cheaper. Custom key store keys also incur per-operation costs, but you also have the CloudHSM cluster costs regardless of usage level.

For many regulated organizations, this cost is simply a line item on the budget. Compliance is non-negotiable, so the infrastructure cost is justified. But if you're on a tight budget or don't have strict compliance requirements, standard KMS keys are almost always more cost-effective.

There's also the hidden cost of operational complexity. CloudHSM requires more hands-on management than standard KMS. If you need to hire additional staff or spend significant engineering time on HSM operations, that should factor into your decision.

### Custom Key Stores vs. Standard KMS Keys

Let me compare these approaches across several dimensions to help you think through which is right for your situation.

**Security and control** clearly favors custom key stores if exclusive control over key material is a requirement. Standard KMS keys are extremely secure—AWS's HSMs are state-of-the-art—but AWS does have access to the infrastructure. If your threat model includes AWS itself as a potential adversary (however unlikely), custom key stores are the answer.

**Operational complexity** is a significant difference. Standard KMS is essentially hands-off. AWS manages everything. Custom key stores require you to manage CloudHSM, plan capacity, handle backups, and monitor the infrastructure. If your team doesn't have the expertise or bandwidth for this, standard KMS is much simpler.

**Cost** generally favors standard KMS unless you need dedicated infrastructure for compliance. With standard KMS, you pay per operation. With custom key stores, you're paying a baseline cost for the HSM cluster regardless of usage.

**Performance and throughput** depends on your workload. Standard KMS has virtually unlimited throughput; AWS scales transparently. Custom key stores are bounded by your HSM cluster capacity. If you have very high throughput requirements, you may need to factor in additional HSMs.

**Integration with AWS services** is essentially equivalent; most services that support customer-managed keys work with both approaches. But verify specific service support for custom key stores before committing to this architecture.

**Regulatory compliance** is where custom key stores shine. If you have requirements for exclusive control over key material, for hardware-backed cryptography, or for specific audit trails, custom key stores are purpose-built for this.

### Best Practices and Recommendations

If you decide to implement custom key stores, here are practices that will serve you well.

Plan for redundancy from the start. A single CloudHSM is a production risk. Build your cluster with at least two HSMs in the same region for high availability, and consider multi-region clusters if disaster recovery is critical.

Implement robust password and credential management. The HSM administrator password is critical infrastructure security. Use AWS Secrets Manager to store it, implement rotation policies, and limit access to only those who absolutely need it.

Monitor your HSM cluster actively. Set up CloudWatch alarms for HSM health, capacity utilization, and error rates. Review HSM audit logs regularly. Treat your custom key store as critical infrastructure.

Plan your backup strategy early. Test backup and restore procedures in a development environment before relying on them in production. Know your RTO and RPO requirements and ensure your backup strategy meets them.

Document your key usage. Understand which applications and services depend on keys in your custom key store. This helps with capacity planning and makes troubleshooting easier.

Implement key rotation. Even though the key material stays in your HSM, KMS supports rotating the backing key material. Implement a regular rotation schedule appropriate for your compliance requirements.

Work with compliance and security teams early in the design process. Understand exactly what requirements you're trying to meet, and validate that your custom key store architecture actually addresses them. Sometimes the requirement is for CloudHSM, sometimes it's for multi-region redundancy, sometimes it's just for audit logs. Make sure you're building the right solution.

### Common Challenges and Troubleshooting

In practice, several issues come up frequently. CloudHSM cluster connectivity problems are among the most common. If your custom key store shows as "DISCONNECTED," verify that the cluster is healthy, that network connectivity exists between KMS and the cluster, and that credentials are correct. These are usually network or configuration issues rather than hardware problems.

Capacity problems manifest as increased latency or throttling. If you notice that KMS operations are slowing down, check your HSM utilization. If it's consistently high, you need to add HSMs to your cluster.

Backup and restore issues can be tricky. If you're restoring a backup, ensure that the network configuration and VPC routing match your original setup. Backups are cluster-specific; you can't restore a backup from one cluster into a different cluster.

Key material loss is a nightmare scenario that's preventable through proper backups. Never assume you don't need backups. If you can't access your key material and you don't have a backup, your encrypted data is permanently inaccessible.

### The Future of Custom Key Stores

AWS continues to invest in both KMS and CloudHSM. Over time, we've seen improvements to custom key stores' availability properties, better integration with additional AWS services, and improved tooling. If you're considering custom key stores for a new project, keep an eye on AWS announcements about features like expanded CloudHSM support or improved multi-region capabilities.

### Conclusion

KMS custom key stores represent a thoughtful solution to a genuine tension in cloud security: the desire for AWS's convenience and integration with the requirement for exclusive control over key material. They're not appropriate for every workload—they add operational complexity and cost—but for organizations with regulatory requirements or philosophical commitments to key material control, they're invaluable.

The decision to implement custom key stores should be driven by clear requirements, not by vague concerns. Understand exactly what compliance or control you need, validate that custom key stores address those needs, and plan carefully for the operational responsibilities you're assuming. If you do this, custom key stores can give you a well-architected solution that satisfies both security and compliance requirements while maintaining the developer experience that makes AWS services valuable.
