---
title: "Macie Findings Deep Dive: Sensitive Data Categories and Custom Identifiers"
---

## Macie Findings Deep Dive: Sensitive Data Categories and Custom Identifiers

Amazon Macie is AWS's intelligent data security service that automatically discovers and classifies sensitive data across your AWS environment. While many developers understand that Macie scans for sensitive information, fewer grasp the nuances of how it categorizes findings, interprets severity, and—most importantly—how to extend its capabilities with custom identifiers tailored to your organization's unique data patterns. This article explores those deeper waters, equipping you with the knowledge to not only interpret Macie findings effectively but also configure the service to catch sensitive data that managed identifiers alone might miss.

### Understanding Macie's Two Findings Architecture

Macie operates on a dual-layer findings model that's crucial to understand. The service generates two distinct types of findings: policy findings and sensitive data findings. Confusing these two can lead to incomplete data protection strategies.

**Policy findings** alert you when Macie detects potential risks in your bucket or object configurations themselves—things like overly permissive access controls, encryption gaps, or public accessibility. These findings focus on *how* your data is stored and accessed, not necessarily *what* the data is. For example, if you have an S3 bucket with public read access, Macie will flag that as a policy finding regardless of what objects live inside it.

**Sensitive data findings**, by contrast, are triggered when Macie's detection mechanisms identify actual sensitive content within your objects. These findings tell you that specific data—a credit card number, a private key, a social security number—exists in your S3 buckets. This distinction matters because you could have a perfectly locked-down bucket (no policy findings) that still contains highly sensitive data (numerous sensitive data findings), or vice versa. Both demand attention, but for different reasons.

When you first enable Macie in your AWS environment, it performs an initial discovery and classification job that can take hours or even days depending on the volume of data. During this time, it scans existing objects using both managed identifiers (built-in detection patterns) and any custom identifiers you've already configured. Afterward, Macie operates in real-time mode, analyzing new and modified objects as they arrive in monitored S3 buckets.

### The Managed Data Identifier Categories

AWS Macie ships with a comprehensive library of managed data identifiers—predefined detection patterns maintained by AWS that recognize common sensitive data types. These identifiers are organized into logical categories, and understanding each category helps you assess whether Macie's out-of-the-box capabilities align with your organization's needs.

**Personally Identifiable Information (PII)** is the broadest and most commonly detected category. Macie's PII identifiers search for social security numbers (in various formats, including with and without dashes), names paired with date-of-birth information, passport numbers, driver's license numbers, and national ID numbers from various countries. The service is smart about context—it recognizes that a nine-digit number in isolation might not be a social security number, but when found in specific contexts or combined with other data markers, it becomes far more likely to be one. Macie also detects email addresses and phone numbers, though the sensitivity threshold for these is appropriately lower since they're often less critical than other PII elements.

**Financial information** identifiers catch credit card numbers in multiple formats (Visa, Mastercard, American Express, Discover), bank account numbers, and routing numbers. Macie's credit card detection is particularly sophisticated—it understands that credit card numbers follow specific patterns and checksums, so it avoids flagging random 16-digit sequences. Bank routing numbers, typically nine digits, are detected when found in patterns consistent with how financial institutions format them.

**Credentials and secrets** are arguably the most critical category from a security standpoint. Macie identifies AWS access key IDs and secret access keys by their distinctive formats (access keys start with AKIA, for example). It also detects private keys in PEM format, API tokens, and various database connection strings. These findings demand immediate action, as compromised credentials can lead to unauthorized access across your entire AWS environment or connected systems.

**API keys and OAuth tokens** form a subset within the credentials category. Macie recognizes tokens and keys from popular services like Slack, GitHub, Twilio, and dozens of others. The detection often relies on identifying the characteristic prefixes and formats these services use.

**Medical and health information** includes patient names linked with medical record numbers, health insurance member IDs, and healthcare provider identification numbers. If your organization handles healthcare data, you'll want to pay close attention to these findings, as they carry significant compliance implications under regulations like HIPAA.

**Intellectual property identifiers** detect things like patent numbers, registered trademarks, and copyrights when found in specific formats. These are less commonly flagged in typical development environments but can be important in organizations working with proprietary technology or creative assets.

The complete list of managed identifiers is extensive, and AWS regularly adds new ones. Each identifier in each category comes with a confidence level—AWS assigns a percentage indicating how confident the service is that a detected pattern actually represents sensitive data rather than a false positive. A high-confidence finding is more likely to be genuinely sensitive, while lower-confidence findings warrant human review to determine whether they're true positives or noise.

### Interpreting Severity Levels

Macie assigns severity levels to sensitive data findings, and these levels should drive your prioritization and response. Understanding what each level represents helps you allocate investigation resources effectively.

**Critical findings** indicate the discovery of high-impact sensitive data that requires immediate action. AWS typically assigns this level to findings that involve large quantities of highly sensitive data, such as discovering thousands of objects containing credit card numbers or private keys. A critical finding is your signal to stop and respond now—this could represent a significant security incident or a critical misconfiguration.

**High severity findings** are still serious and should be addressed quickly, usually within hours or a single business day. These typically involve a moderate quantity of sensitive data or sensitive data that's particularly risky in your context. For example, finding a few exposed AWS credential files would be high severity because credential compromise poses immediate risk, even if the quantity is small.

**Medium severity findings** warrant investigation and remediation within a reasonable timeframe—typically a few days. These might involve a small number of objects containing PII or financial information, or situations where the sensitive data is less immediately exploitable.

**Low severity findings** are the least urgent but still worth noting. They might represent data types that are less sensitive in your context, or patterns with lower confidence levels. That said, "low" doesn't mean "ignore"—over time, multiple low-severity findings can reveal patterns suggesting a broader data protection issue.

Severity isn't determined by finding type alone. Macie considers the quantity of sensitive data detected, how confident the detection is, and the nature of the sensitive information itself. A finding with hundreds of instances of detected credit card numbers will be rated more severely than a finding with three instances.

### Custom Identifiers: Extending Macie's Capabilities

While managed identifiers cover common sensitive data types, every organization has unique data that needs protection. You might use internal employee ID formats, proprietary reference codes, customer account identifiers, or other organizational-specific data structures that Macie's standard identifiers won't recognize. This is where custom identifiers come in.

Custom identifiers in Macie allow you to define patterns for sensitive data unique to your organization. You create them by specifying detection patterns (using regular expressions), supplementary keywords, and rules to minimize false positives. The investment in setting up well-tuned custom identifiers pays dividends by ensuring Macie catches your organization's specific risks.

When you create a custom identifier, you start by defining its name and description—make these meaningful, as you'll want to quickly understand what each identifier detects when you review findings. Next, you specify the detection pattern using regular expressions. A regex pattern is a text string that defines how to match your sensitive data format.

Consider a practical example. Suppose your organization uses employee IDs in the format "EMP" followed by exactly six digits, like "EMP123456" or "EMP000001". You'd create a custom identifier with a regex pattern like `\bEMP\d{6}\b`. Let's break this down: `\b` marks a word boundary (ensuring we match whole IDs, not partial matches within longer strings), `EMP` matches those literal characters, `\d{6}` matches exactly six digits, and the final `\b` marks the end word boundary.

Now, regex patterns alone can be overly broad. A pattern like `\bEMP\d{6}\b` might match employee IDs legitimately used in documentation, examples, or test data where they're not actually sensitive. This is where Macie's additional configuration options become valuable.

**Keyword requirements** let you specify that a pattern must appear near certain keywords to be flagged as sensitive. For your employee ID example, you might require that the pattern appear near keywords like "employee", "personnel", "staff", or "HR". This means the pattern `EMP123456` would only be flagged as sensitive if it appears in the same proximity (typically the same line or paragraph) as one of these keywords. This dramatically reduces false positives from documentation or examples that use the format.

**Ignore lists** provide another layer of false positive reduction. If you know that certain instances of your pattern are legitimate and not sensitive—perhaps test employee IDs used in your sample databases—you can add those specific values to an ignore list. Macie will continue to search for the pattern but won't flag any instances that match values in your ignore list. For example, you might add "EMP000000" through "EMP000099" as test values to ignore.

You can also specify **maximum match distance**, which defines how far apart different components of your pattern can be within an object. For more complex patterns, this helps ensure you're matching genuine instances rather than coincidental adjacent occurrences of separate things.

### Creating a Custom Identifier: A Worked Example

Let's work through a complete example to make these concepts concrete. Imagine your organization uses internal reference codes for projects in the format "PRJ-" followed by two letters indicating the project type, a hyphen, and then a four-digit year and two-digit month. So valid codes look like: "PRJ-AI-202401", "PRJ-ML-202312", etc. This is sensitive data because it reveals your project schedule and types.

First, you'd craft your regex. Breaking down the format:
- `PRJ-` is a literal string
- Two letters: `[A-Z]{2}`
- A hyphen: `-`
- Year (four digits): `\d{4}`
- Month (two digits): `\d{2}`

Your complete pattern would be: `PRJ-[A-Z]{2}-\d{4}\d{2}`

But you realize this pattern might match text in your project documentation where you're explaining the format, or in test scripts. So you add keyword requirements: the pattern must appear near keywords like "project", "initiative", "code", or "reference". This ensures casual mentions of the format itself won't trigger false positives, only actual project references embedded in data.

You also maintain an ignore list of project codes used in public examples or documentation: "PRJ-EX-202401", "PRJ-DM-202312". These can exist in README files without being flagged as sensitive findings.

When you create this custom identifier in the Macie console, you'd fill in:

- **Name**: "Internal Project Reference Codes"
- **Description**: "Identifies sensitive internal project codes in format PRJ-XX-YYYYMM"
- **Regular expression**: `PRJ-[A-Z]{2}-\d{4}\d{2}`
- **Keywords**: ["project", "initiative", "code", "reference"]
- **Ignore list**: ["PRJ-EX-202401", "PRJ-DM-202312"]

Once created and enabled, this custom identifier works alongside your managed identifiers. When Macie scans your S3 buckets, it will flag any occurrences of matching patterns that also satisfy your keyword requirements and aren't in your ignore list.

### Tuning Custom Identifiers to Reduce False Positives

The real art of effective Macie configuration lies in reducing false positives without compromising detection. A security tool that cries wolf too often gets ignored; one that's too strict misses real issues. Finding the right balance requires iteration.

Start by creating a custom identifier with a reasonable pattern and then monitor the findings it generates for a week or two. Review the findings manually—are they genuine sensitive data instances, or are they false positives? If you're seeing many false positives, adjust your configuration.

If your regex pattern is too broad, consider making it more specific. If your project code example above was matching things like "programming-2024-01", you'd need a stricter pattern that requires the exact "PRJ-" prefix.

If your findings are predominantly real but you're seeing some noise, layer on keyword requirements. Keywords are your strongest false positive defense because they require contextual evidence of sensitivity. A project code mentioned in a schema definition might not need flagging, but a project code in a CSV file alongside customer names almost certainly does.

Ignore lists are useful for known test data or public examples, but don't overuse them. If you find yourself adding dozens of values to an ignore list, that's a signal that your pattern or keywords need refinement instead. An overly broad ignore list can create blind spots.

You can also adjust the maximum match distance. If your pattern has multiple components spread across a wide area within an object, increasing the max distance ensures you still catch them. Conversely, if you're seeing false positives from distant, unrelated pattern components coincidentally appearing near each other, decreasing the distance can help.

After adjusting, re-enable the identifier and monitor for another cycle. This iterative approach—create, monitor, adjust, refine—leads to custom identifiers that reliably catch your organization's sensitive data while minimizing investigation overhead from false positives.

### Practical Considerations for Implementation

When deploying Macie in a real organization, several practical considerations should guide your approach. First, enable managed identifiers for all standard categories relevant to your industry and regulatory environment. There's no performance penalty for having identifiers enabled; you only pay for the data scanned, not the number of patterns checked. A healthcare organization should enable medical information identifiers; a fintech company should prioritize financial identifiers.

Start with managed identifiers before creating custom ones. Let Macie run for a few weeks to establish a baseline of what it finds. Review the findings it generates and their severity ratings. This baseline helps you understand where your data risks actually are before you invest effort in custom identifiers.

When you do create custom identifiers, start with high-value data types. What sensitive data, if exposed, would create the most business impact or compliance risk? Build custom identifiers for those first. Employee IDs might be lower priority than customer payment information or trade secrets, depending on your business.

Document your custom identifiers well. Include comments about why you created them, what problem they solve, and how they're configured. This documentation becomes invaluable when team members need to interpret findings or adjust identifiers over time.

Macie findings should feed into your incident response process. When a critical or high-severity finding appears, have a defined workflow for investigation. Who investigates? What do they check? Who makes remediation decisions? Are there automated responses for certain finding types? These questions should be answered before you're in the middle of responding to a real finding.

Remember that Macie is one piece of a larger data protection strategy. It works best when combined with S3 access logging, AWS CloudTrail, bucket policies, and encryption. A sensitive data finding is more actionable when you can also see who accessed the object and when, or confirm that it's encrypted.

### Monitoring and Maintenance

Macie's effectiveness depends on ongoing attention. Check your Macie dashboard regularly—weekly is reasonable for most organizations. Look for trends: are certain types of findings increasing? Do you see patterns suggesting a new source of sensitive data appearing in your buckets?

Revisit custom identifiers periodically. The data landscape in your organization evolves; data formats change, new systems come online, and business priorities shift. A custom identifier that was crucial two years ago might be obsolete now, while new patterns need protection.

When you update your custom identifiers—adjusting patterns, keywords, or ignore lists—Macie doesn't automatically re-scan historical data. You can trigger a re-scan of your S3 buckets through the console, though this can take time on large environments. Schedule re-scans during off-hours and monitor completion.

Use Macie's filtering and search capabilities to drill into findings. The console lets you filter by severity, finding type, data identifier, S3 bucket, and date range. These filters are powerful tools for understanding patterns and investigating specific scenarios.

### Conclusion

Macie's dual-findings architecture and extensive managed identifier library provide a strong foundation for data discovery and classification. But true mastery comes from understanding your organization's unique sensitive data landscape and extending Macie with well-crafted custom identifiers. By combining thoughtful regex patterns, strategic keyword requirements, and carefully maintained ignore lists, you create a security tool that reliably catches your organization's specific risks without drowning your team in false positives.

The effort you invest in setting up and tuning custom identifiers pays dividends throughout your security program. Well-configured Macie findings become trusted alerts that your team responds to immediately, knowing that critical, high-severity findings represent genuine risks requiring action. Start with managed identifiers, let them establish a baseline, then methodically add custom identifiers for your organization's highest-value sensitive data types. Monitor regularly, adjust as needed, and integrate findings into your incident response process. This layered, ongoing approach to Macie configuration transforms it from a compliance checkbox into a genuinely effective component of your data security strategy.
