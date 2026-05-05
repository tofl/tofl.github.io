---
title: "Dedicated IPs vs Shared IPs in Amazon SES: When to Choose Each"
---

## Dedicated IPs vs Shared IPs in Amazon SES: When to Choose Each

When you first set up Amazon Simple Email Service (SES), you're placed on AWS's shared IP infrastructure by default. It's a sensible starting point that requires zero configuration and lets you begin sending emails immediately. But as your application scales or your deliverability requirements tighten, you'll eventually face a decision: should you upgrade to dedicated IP addresses? And if so, what's the difference between a single dedicated IP and the newer dedicated IP pools feature?

This decision often flies under the radar for developers, yet it has profound implications for email delivery, reputation management, and operational costs. The right choice depends on your sending volume, compliance requirements, traffic patterns, and how much control you want over your sender reputation. Let's work through each option with clarity.

### Understanding the Shared IP Model

The shared IP pool is AWS's default configuration for SES. When you send emails through shared IPs, your messages travel over IP addresses that are also being used by other SES customers to send their own mail. This isn't as chaotic as it sounds—AWS carefully manages these pools, monitors reputation metrics, and applies sophisticated filtering to ensure that legitimate senders thrive while bad actors are quickly isolated.

From a practical standpoint, the shared IP model is wonderfully low-friction. There's no setup required, no warm-up period, and no additional cost beyond your actual sending charges. AWS handles all reputation management on the backend. If you send 10,000 emails one month and 50,000 the next, your configuration doesn't change. The infrastructure simply scales with you.

The trade-off is that your deliverability depends partly on the behavior of other customers on the same pool. If another sender is sending spam or has poor list hygiene, the shared IP's reputation could suffer, potentially affecting your inbox placement rates. In practice, AWS's reputation management is robust enough that this risk is minimal for legitimate senders, but it remains a real consideration, especially if you're operating in highly competitive industries like financial services or healthcare where inbox placement can make or break your business.

Shared IPs work well for most use cases: newsletters, transactional email, user notifications, and similar volume that falls below roughly 100,000 emails per month. If your sending patterns are steady and your email list is well-maintained, shared IPs will deliver consistent results without the complexity of dedicated infrastructure.

### The Case for Dedicated IP Addresses

A dedicated IP is an IP address reserved exclusively for your AWS account and your sending activity. When you lease a dedicated IP from SES, you alone control its reputation. Every email you send—good or bad—affects only your own delivery metrics.

The immediate benefit is predictability and control. Your inbox placement rates depend entirely on your own sender practices: list quality, engagement metrics, authentication setup, and sending volume consistency. You're not subject to the collective behavior of other senders. This is particularly valuable if you're sending very high volumes or operating in regulated industries where compliance and audit trails matter.

However, dedicated IPs come with responsibilities. Most importantly, they require a warm-up period. When you first provision a dedicated IP, it has no sending history and no established reputation. Mail servers on the receiving end treat it with suspicion. Amazon recommends gradually ramping up your sending volume over roughly two weeks, starting with perhaps 100 emails on day one and progressively increasing until you reach your target volume. This ramp-up tells receiving networks that the IP is legitimate and intentional, not a bot launching a spam campaign.

There's also additional cost. As of this writing, AWS charges roughly $24.95 USD per dedicated IP per month (pricing varies by region). If you're using multiple dedicated IPs, that cost multiplies. This makes dedicated IPs economical primarily for high-volume senders where the per-email cost of the dedicated IP becomes negligible.

When does high volume justify dedicated IPs? A reasonable rule of thumb is around 100,000 emails per month or higher. At that volume, a dedicated IP's monthly cost is spread across millions of emails, reducing the per-email overhead to fractions of a cent. For lower volumes, the cost-benefit calculation typically favors shared IPs.

### Dedicated IP Pools: Segmenting Your Reputation

Amazon introduced dedicated IP pools as a refinement to the dedicated IP model, addressing a nuanced but real problem: not all email traffic is created equal. Many organizations send multiple types of email—promotional campaigns, transactional notifications, account alerts, etc.—and these types often have different engagement patterns and deliverability characteristics.

With dedicated IP pools, you can lease multiple dedicated IPs and logically group them into pools. Each pool is associated with a configuration set, and your application can choose which pool to use based on the type of email being sent. This means you can isolate, for example, your high-engagement transactional emails on one pool while running a promotional campaign on another, preventing a poorly-performing campaign from dragging down the reputation of your critical transactional mail.

Consider a concrete scenario: you run a SaaS application that sends both password-reset emails (which have very high engagement rates) and weekly product update digests (which have moderate engagement). If both types ride the same IP, a poorly-timed digest campaign might lower open rates enough to affect inbox placement for password resets on downstream attempts. With dedicated IP pools, you isolate them entirely, and each pool builds its own reputation based on its own engagement metrics.

Setting up pools requires a bit more configuration. You define multiple configuration sets in SES, associate dedicated IPs with each set, and then instruct your application to use the appropriate set when sending. The AWS SDK makes this straightforward—it's just an additional parameter when you invoke the send email function.

The cost scales linearly: if you lease three dedicated IPs in a pool arrangement, you pay for three IPs. But for organizations sending hundreds of thousands of emails across diverse use cases, the granular reputation control is often worth it.

### Making the Decision: A Framework

Choosing between shared IPs, a single dedicated IP, or dedicated IP pools comes down to a few key factors.

**Sending volume** is the primary lever. If you're consistently sending fewer than 50,000 emails per month, shared IPs almost certainly make financial sense. The per-email cost of dedicated IP leasing is too high to justify. From 50,000 to 100,000 emails per month, it's a judgment call—if your inbox placement is critical and you're willing to absorb the cost, dedicated IPs start becoming reasonable. Above 100,000 emails per month, dedicated IPs become economically attractive and often necessary if you want tight control over reputation.

**Reputation sensitivity** matters enormously. Some use cases are forgiving. If you're sending reminder notifications to users who opted in, occasional fluctuations in inbox placement don't significantly impact your business. But if you're sending time-sensitive transactional emails—password resets, payment confirmations, shipping alerts—even small degradations in deliverability can cause operational problems. For reputation-sensitive use cases, dedicated IPs provide peace of mind even at lower volumes.

**Traffic diversity** tips the scales toward dedicated IP pools. If you send only one type of email, a single dedicated IP is simpler and cheaper. But if your sending profile includes multiple distinct traffic types with different characteristics, pools let you manage reputation with surgical precision.

**Compliance and audit requirements** are another consideration. Some industries require demonstrating control over infrastructure. Dedicated IPs provide clear audit trails and dedicated reputation metrics that satisfy regulatory scrutiny. Shared IPs, while perfectly legitimate, offer less granular control for documentation purposes.

**Sending patterns** also factor in. If your volume is erratic—huge spikes followed by quiet periods—shared IPs handle the variability gracefully. Dedicated IPs, by contrast, prefer consistent volume. If you send 500,000 emails one month and 10,000 the next, reputation metrics become harder to interpret and inbox placement can suffer.

### Practical Implementation Considerations

If you decide to move to dedicated IPs, start with a single IP and validate the impact before leasing additional ones. Request the dedicated IP through the AWS SES console, and AWS will provision it within a few hours. You'll need to register it with major ISPs as part of the warm-up, which AWS guides you through.

The warm-up process is non-negotiable, and it's worth planning carefully. Have a realistic sending volume projection for the warm-up period. If you don't have enough legitimate mail to send during warm-up, you might send test messages to internal addresses or work with partners to generate low-volume traffic. The goal is to establish a positive pattern without flooding the IP.

Monitor metrics obsessively during warm-up. CloudWatch integration with SES lets you track bounce rates, complaint rates, and delivery rates in real time. If metrics start trending poorly, investigate immediately. It usually signals a problem with your email list or sending practices, not the warm-up itself.

If you're using dedicated IP pools, plan your configuration sets carefully. Name them descriptively—something like `config-set-transactional` and `config-set-promotional` rather than `pool1` and `pool2`. Document which IPs are associated with which sets so future team members understand your routing logic.

### The Migration Path

Moving from shared to dedicated IPs doesn't have to be a big bang event. You can test drive a dedicated IP with a subset of your traffic first. Send promotional campaigns on a dedicated IP while keeping transactional mail on shared IPs. Monitor results for two to four weeks, then make a final decision. This approach reduces risk and gives you real-world data on whether the investment makes sense for your use case.

If you do migrate, remember that reputation doesn't transfer. Your new dedicated IP starts from zero, regardless of your shared IP history. Plan accordingly and don't expect identical metrics immediately. It typically takes four to six weeks for a dedicated IP to stabilize at a reputation level comparable to what you'd see on a healthy shared IP pool.

### Conclusion

The choice between shared IPs, dedicated IPs, and dedicated IP pools isn't a simple one-size-fits-all decision. Shared IPs remain the right starting point for most developers: they're cost-effective, require no configuration, and deliver excellent results for low-to-moderate sending volumes. Dedicated IPs become worthwhile when volume climbs or when control over reputation is business-critical. And dedicated IP pools serve organizations with diverse sending needs who want to manage reputation with precision across different email types.

Start with shared IPs. Monitor your sending volume and deliverability metrics as you scale. When you hit 100,000 emails monthly or when you notice inbox placement concerns, revisit the decision. By then, you'll have real data about your own sending patterns, making the choice between options much clearer. The flexibility to move between these models is one of SES's underrated strengths—you can evolve your email infrastructure as your business demands change.
