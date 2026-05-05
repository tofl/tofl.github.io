---
title: "Setting Up SPF, DKIM, and DMARC for Amazon SES Domain Verification"
---

## Setting Up SPF, DKIM, and DMARC for Amazon SES Domain Verification

Email deliverability is one of those topics that developers often underestimate until their carefully crafted notifications land in the spam folder—or worse, never arrive at all. If you're planning to send email at scale using Amazon Simple Email Service (SES), you need to understand and properly implement three authentication standards: SPF, DKIM, and DMARC. These aren't optional niceties; they're essential for modern email delivery.

This article walks you through each standard, explains why it matters, and shows you exactly how to configure them for your SES setup. By the end, you'll have a fully authenticated domain and a solid understanding of how email receivers validate that you are who you claim to be.

### Why Email Authentication Matters

Imagine you receive an email claiming to be from your bank asking you to confirm your password. How do you know it's actually from your bank and not a phisher spoofing the domain? The answer lies in the standards we're about to explore.

Mail servers receiving your email check for SPF, DKIM, and DMARC records to verify that you're authorized to send on behalf of your domain. Major email providers like Gmail, Outlook, and Yahoo use these checks to decide whether your email is legitimate or suspicious. If you skip authentication, your legitimate emails are far more likely to be filtered as spam—or rejected outright.

When you use SES, you're leveraging Amazon's infrastructure, but the responsibility for proving domain ownership and authorization falls on you. The good news is that SES makes this relatively straightforward once you understand the mechanics.

### Understanding SPF: Sender Policy Framework

SPF is the first line of defense. It's a TXT record published in your domain's DNS that tells mail servers: "Here are the IP addresses and mail servers authorized to send email from my domain."

Think of SPF like a guest list. When someone sends an email claiming to be from `user@yourdomain.com`, the receiving mail server looks up your SPF record and checks whether the sending server's IP address appears on your approved list. If it does, the SPF check passes. If not, it fails.

With SES, you're delegating email sending to Amazon's servers. So your SPF record needs to authorize Amazon's mail servers. This is done by including a reference to Amazon's SPF infrastructure.

#### Publishing Your SPF Record

Log into your domain registrar or DNS hosting provider and navigate to the DNS management section. You'll need to add a TXT record for your domain (or subdomain, if you prefer). The exact location varies by provider—some call it DNS Records, others call it Zone File—but the concept is the same.

For a domain sending through SES, your SPF record should look like this:

```
v=spf1 include:amazonses.com ~all
```

Let's break down this syntax:

- `v=spf1` declares this as an SPF version 1 record.
- `include:amazonses.com` tells mail servers to also check Amazon's SPF record and accept any servers listed there. This is how we authorize SES without hardcoding specific IP addresses.
- `~all` is the fail softener. It says: "If a mail server doesn't match any of the mechanisms above, it's a soft fail." A soft fail is more lenient than a hard fail (`-all`) and won't immediately reject the email, though it may be flagged as suspicious.

If you're already sending mail from other services (like a marketing platform or a legacy email server), your SPF record might already exist. In that case, you'll need to append the Amazon SES include to your existing record:

```
v=spf1 include:otherprovider.com include:amazonses.com ~all
```

The order of includes doesn't matter, but there's a practical limit: SPF records can't have more than ten DNS lookups. If you have many includes, you might hit this limit and need to consolidate or restructure your authentication.

#### SPF Propagation

After you add the SPF record, DNS changes take time to propagate worldwide. The TTL (Time To Live) value on your record determines how long other DNS servers cache the result. Common TTL values range from 300 seconds (5 minutes) to 86400 seconds (24 hours). Servers respect your TTL, so if you set it to 3600 seconds, most servers will cache your record for an hour before checking again.

In practice, propagation usually completes within a few minutes to a few hours, but it's wise to wait and validate before troubleshooting. You can check propagation using public DNS lookup tools, which we'll cover later.

### Understanding DKIM: DomainKeys Identified Mail

While SPF validates that the sending server is authorized, DKIM goes further: it cryptographically signs the email itself. The receiving mail server can verify the signature and confirm that the email wasn't altered in transit and genuinely comes from your domain.

DKIM works by using a pair of cryptographic keys: a private key (kept secret by you) that signs outgoing emails, and a public key (published in DNS) that receivers use to verify the signature. When SES sends an email from your domain, it signs it with the private key. When the receiving mail server gets the email, it retrieves your public key from DNS and checks that the signature is valid.

#### Enabling Easy DKIM in SES

The traditional way to set up DKIM involves generating your own key pair and managing it yourself. But SES offers a simpler option called Easy DKIM. When you enable Easy DKIM, SES generates the key pair, keeps the private key secure, and gives you the public key in the form of DNS records to publish.

To enable Easy DKIM, you'll use the AWS Management Console, the AWS CLI, or the SES API. Let's walk through the console approach first.

Navigate to the SES service in the AWS Management Console. Go to Verified Identities (in older console versions, this might be called Domains or Email Addresses). Find your domain in the list and click on it.

Look for the DKIM section. You should see a button labeled "Enable DKIM" or "Generate DKIM tokens." Click it. SES will generate three DKIM tokens and display them to you.

Each token corresponds to a CNAME record you'll need to add to your DNS. The console displays something like:

```
Token 1: aaaabbbbccccdddd
Name: aaaabbbbccccdddd._domainkey.yourdomain.com
Value: aaaabbbbccccdddd.dkim.amazonses.com

Token 2: eeeeffffgggghhhh
Name: eeeeffffgggghhhh._domainkey.yourdomain.com
Value: eeeeffffgggghhhh.dkim.amazonses.com

Token 3: iiiijjjjkkkkllll
Name: iiiijjjjkkkkllll._domainkey.yourdomain.com
Value: iiiijjjjkkkkllll.dkim.amazonses.com
```

Why three tokens? SES uses multiple DKIM keys for redundancy and key rotation. If one key is compromised, the others remain valid. During normal operations, SES uses all three keys to sign emails, and receiving servers accept a signature from any of them.

#### Adding DKIM Records to DNS

Now you need to add three CNAME records to your DNS. A CNAME (Canonical Name) record is a DNS record that points one domain name to another. In this case, each token points to SES's DKIM infrastructure.

Go to your DNS provider and add three new CNAME records. Use the token names as the record names and the token values as the targets. For example:

**Record 1:**
- Name: `aaaabbbbccccdddd._domainkey.yourdomain.com`
- Type: CNAME
- Value: `aaaabbbbccccdddd.dkim.amazonses.com`

Repeat for the other two tokens. The exact interface varies by provider, but every DNS provider supports CNAME records in the same way.

#### Why DKIM Improves Deliverability

When a mail server receives an email signed with your DKIM key, it gains confidence that the email is authentic. Email filters use DKIM validation as a signal: emails with valid DKIM signatures are more likely to be legitimate. Conversely, emails from high-volume spammers often fail DKIM checks because they haven't bothered to set it up.

DKIM signatures are also preserved even if email is forwarded or archived. Unlike SPF, which only checks the initial hop, DKIM remains valid throughout the email's lifecycle.

### Understanding DMARC: Domain-based Message Authentication, Reporting, and Conformance

SPF and DKIM authenticate the email itself, but they don't tell mail servers what to do if the checks fail. That's where DMARC comes in. DMARC is a policy framework that tells mail servers how to handle emails that fail SPF or DKIM checks, and it provides feedback about authentication results.

A DMARC policy is published as a TXT record in a special subdomain: `_dmarc.yourdomain.com`. The policy specifies three main things:

- What to do with emails that fail authentication (the action policy)
- What percentage of failing emails should be subjected to that action
- An email address to which feedback reports should be sent

#### DMARC Policy Actions

DMARC supports three policy actions, arranged from most lenient to most strict:

**p=none** is the monitoring mode. Mail servers still perform DMARC checks and send you feedback reports, but they don't take any special action on failing emails. They deliver them normally. This is the starting point for every domain implementing DMARC. You use this phase to monitor what's happening and ensure your legitimate email isn't failing checks.

**p=quarantine** tells mail servers to place emails that fail DMARC checks into the spam folder or quarantine, rather than rejecting them outright. This strikes a balance: suspicious emails are isolated, but they're not lost completely. Some legitimate mail might still get through if filters are lenient.

**p=reject** is the strictest policy. Mail servers reject emails that fail DMARC checks entirely. They don't reach the recipient's inbox or spam folder; they're refused at the SMTP level. This is the most secure posture but requires absolute confidence that all your legitimate emails pass authentication.

#### Crafting Your DMARC Record

Here's a basic DMARC policy to start with:

```
v=DMARC1; p=none; rua=mailto:dmarc-reports@yourdomain.com
```

Breaking this down:

- `v=DMARC1` declares this as a DMARC version 1 record.
- `p=none` sets the policy to monitoring mode.
- `rua=mailto:dmarc-reports@yourdomain.com` specifies the email address where aggregate reports should be sent. These reports tell you how many emails passed or failed authentication, broken down by sending source.

You'll also want to add a `ruf` (forensic reports) address, though this is optional:

```
v=DMARC1; p=none; rua=mailto:dmarc-reports@yourdomain.com; ruf=mailto:forensic-reports@yourdomain.com
```

Forensic reports provide detailed information about individual emails that failed, which is useful for troubleshooting but can generate a lot of email. Many organizations skip forensic reports in favor of aggregate reports alone.

#### Publishing Your DMARC Record

Add a TXT record to DNS with the name `_dmarc.yourdomain.com` and the policy as the value. Note the underscore—it's part of the record name, not optional.

After publication, monitoring mode will collect data about your email authentication. Most email providers start sending aggregate reports after a day or so. These reports tell you how many emails from your domain passed SPF, DKIM, both, or neither.

#### Monitoring and Iterating

Spend at least a week in monitoring mode before tightening your policy. During this time, review the DMARC reports you receive. If you see a significant percentage of your legitimate email failing checks, you need to investigate before moving to quarantine or reject.

Common scenarios that cause failures include:

- Legitimate sources you forgot to authenticate (like a partner's mail server)
- SPF include chains that exceed the DNS lookup limit
- Mailing list software that modifies email headers in ways that break DKIM signatures

Once you're confident that the vast majority of your legitimate email passes DMARC, you can gradually tighten your policy. Many organizations move to `p=quarantine` first, monitor for a week or two, then move to `p=reject`.

Here's a more mature DMARC policy:

```
v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@yourdomain.com; ruf=mailto:forensic-reports@yourdomain.com; fo=1
```

The `fo=1` parameter means "send forensic reports if any authentication mechanism fails," which is useful during the quarantine phase.

And finally, a strict policy for organizations with high confidence in their authentication:

```
v=DMARC1; p=reject; rua=mailto:dmarc-reports@yourdomain.com; ruf=mailto:forensic-reports@yourdomain.com; aspf=s; adkim=s
```

The `aspf=s` and `adkim=s` parameters mean "require strict alignment" for SPF and DKIM respectively. This is a topic worth understanding more deeply, but in brief, they tighten the requirements for what counts as a passing check.

### Validating Your Configuration

After you've published SPF, DKIM, and DMARC records, you need to validate that they're correct and working. Several tools can help.

#### Using the SES Console

The simplest validation happens in the SES console itself. Navigate to Verified Identities and select your domain. The DKIM section shows the status of your DKIM tokens: either "Verified" (green) or "Pending Verification" (yellow/orange). Once all three tokens are verified, DKIM is working.

The console also displays the status of DKIM signing: "Enabled" or "Disabled." If you've enabled Easy DKIM and the tokens are verified, signing is enabled.

#### Using MXToolbox

MXToolbox is a free online tool that checks email authentication records. Navigate to the MXToolbox website and look for the DKIM, SPF, and DMARC checkers. Enter your domain and let the tool query your DNS.

For SPF, the tool shows the full SPF record and highlights any issues (too many lookups, syntax errors, etc.). For DKIM, you can test a specific token name, and the tool shows whether the CNAME record resolves and whether the public key is present. For DMARC, the tool retrieves and parses your DMARC policy.

MXToolbox is invaluable for quick diagnostics, but keep in mind that DNS changes take time to propagate. If a tool says your record doesn't exist, wait a bit and try again.

#### Using Command-Line Tools

If you're comfortable with the command line, you can use `dig` or `nslookup` to query DNS directly. For example, to check your SPF record:

```bash
dig yourdomain.com TXT
```

This returns all TXT records for your domain, including SPF. To specifically check a DKIM token:

```bash
dig aaaabbbbccccdddd._domainkey.yourdomain.com CNAME
```

To check your DMARC policy:

```bash
dig _dmarc.yourdomain.com TXT
```

These command-line tools are powerful because they query actual DNS servers, giving you confidence that records have truly propagated, not just that your local system has a cached copy.

### Troubleshooting DNS Propagation Issues

Even with the right records published, deliverability can suffer if DNS propagation isn't complete or if records are misconfigured. Here are common issues and how to resolve them.

#### Record Isn't Showing Up

You've added a record to your DNS provider, but tools still don't see it. First, verify that you actually saved the record in your DNS provider's interface. It's easy to add a record and then navigate away without saving. Check your DNS provider's dashboard to confirm the record exists.

Next, wait. DNS propagation is not instantaneous. Depending on the TTL value and your DNS provider's configuration, records can take up to 24 hours to fully propagate, though typically it's much faster (minutes to hours). If you're in a hurry, you can reduce the TTL before making the change, so updates propagate faster.

If you've waited and the record still isn't visible, check the record name and value carefully. Copy-paste directly from the SES console or your DNS provider's interface to avoid typos. A single character out of place will cause failures.

#### SPF Lookup Limit Exceeded

SPF allows a maximum of ten DNS lookups. If you have many includes in your SPF record, you might exceed this limit. The error isn't always clear, but tools like MXToolbox will flag it.

If this happens, you have a few options. First, consolidate includes. Some providers offer a single include that encompasses multiple services. Second, use IP addresses instead of includes for some sources, though this is less ideal because IP addresses change. Third, restructure your email sending so fewer sources send on behalf of your domain.

#### DKIM Records Not Resolving

You've added CNAME records, but they're not resolving. Verify that the record name is exactly as SES specified, including the `._domainkey.` part and your domain. DKIM tokens are case-insensitive in DNS, but exact spelling is critical.

Also confirm that you've created CNAME records, not A or AAAA records. A common mistake is choosing the wrong record type in the DNS provider's interface.

If the CNAME records are correct but still not resolving, you might be hitting a limitation with your DNS provider. Some DNS providers don't allow CNAME records at the root of a domain, only on subdomains. If you're trying to set up DKIM for `yourdomain.com` directly, and your DNS provider is blocking it, consider using a subdomain like `mail.yourdomain.com` for SES sending.

#### DMARC Alignment Issues

DMARC alignment is a subtle concept that trips up many people. Alignment means that the domain used for SPF authentication matches the domain in the email's "From" header, and similarly for DKIM.

Suppose you send an email from `user@yourdomain.com`, but the email is actually routed through a partner's mail server that modifies the header slightly. The "From" domain is still `yourdomain.com`, but the envelope sender (the address used for bounce notifications) might be `user@mail.partner.com`. In this case, the SPF domain (partner.com) doesn't match the From domain (yourdomain.com), so DMARC fails even though the email is legitimate.

This is where the `aspf` and `adkim` parameters come into play. `aspf=r` (relaxed, the default) allows the organizational domain to match, even if the subdomain differs. `aspf=s` (strict) requires exact domain matches. Similarly for DKIM with `adkim`.

If you're failing DMARC alignment checks, review the DMARC forensic reports to see which sources are misaligned. You might need to adjust your email routing or DMARC policy parameters.

### Testing SES Email Delivery

Once your authentication is set up, test actual email delivery. The best validation is to send a real email and check it arrives.

If you're in the SES sandbox (the default state for new AWS accounts), you can only send to verified email addresses. To test, add your personal email address as a verified identity, then send a test email using the SES console or API.

Here's a simple example using the AWS CLI:

```bash
aws ses send-email \
  --from sender@yourdomain.com \
  --to recipient@example.com \
  --subject "SPF/DKIM/DMARC Test" \
  --text "Hello, this is a test email."
```

When the email arrives, check the headers. Most email clients let you view full headers or source code. Look for lines like:

```
Authentication-Results: mx.google.com;
  spf=pass
  dkim=pass
  dmarc=pass
```

A passing result on all three indicates your setup is working. If you see failures, use the header information to debug. For example, a failed SPF check might show which IP address was rejected, helping you trace the issue back to your SPF record.

### Moving Beyond the Basics

Once you have SPF, DKIM, and DMARC working, consider these additional steps for production robustness.

**BIMI (Brand Indicators for Message Identification)** is a newer standard that uses your brand logo in email. It requires a valid DMARC policy with p=quarantine or p=reject, plus an SVG logo hosted on your domain. It's optional but increasingly expected by major email providers.

**SMTP TLS** ensures that connections between mail servers are encrypted. SES supports TLS by default, but you can ensure it's enabled in your SES configuration.

**Dedicated IP addresses** in SES give you your own sending IP pool rather than sharing with other SES customers. This is important if you're sending large volumes; a shared IP with a bad actor can hurt your reputation. Dedicated IPs require a higher sending limit and additional monitoring, but they provide more control over your sender reputation.

**Monitoring and alerts** using Amazon CloudWatch and SES metrics help you catch deliverability problems early. Track your bounce rates, complaint rates, and email reputation metrics.

### Conclusion

Email authentication isn't a one-time setup; it's a foundation for reliable delivery. SPF authorizes your sending sources, DKIM cryptographically signs your emails, and DMARC ties them together with a clear policy for handling failures. When implemented correctly, these standards dramatically improve your deliverability rates and protect your domain's reputation.

Start with monitoring mode (DMARC p=none), validate your records with tools like MXToolbox, and gradually tighten your policies as you gain confidence. Send test emails and verify that authentication is passing. Once you've mastered the basics, explore additional standards like BIMI and dedicated IP addresses for even greater control.

By implementing proper email authentication now, you're investing in the long-term success of any application that relies on email delivery. Your users will thank you with emails that reliably land in their inboxes.
