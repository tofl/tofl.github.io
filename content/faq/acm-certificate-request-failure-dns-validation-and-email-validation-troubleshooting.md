---
title: "ACM Certificate Request Failure: DNS Validation and Email Validation Troubleshooting"
---

## ACM Certificate Request Failure: DNS Validation and Email Validation Troubleshooting

When you're building applications on AWS, securing them with HTTPS is non-negotiable. AWS Certificate Manager (ACM) makes this straightforward—in theory. Request a certificate, validate ownership of your domain, and you're done. But in practice, certificate validation can become a frustrating bottleneck when something goes wrong. You might find yourself staring at a certificate stuck in "Pending validation" status, unsure whether the problem lies with DNS propagation, your email configuration, or something more subtle.

This guide walks you through the most common ACM certificate request failures, explains why they happen, and shows you exactly how to fix them. Whether you're validating via DNS or email, understanding these failure modes will save you hours of troubleshooting and get your certificates issued quickly.

### Understanding ACM Certificate Validation

Before diving into troubleshooting, let's clarify how ACM validation works. When you request a new certificate through AWS Certificate Manager, ACM needs to verify that you actually own or control the domain names listed on the certificate. AWS supports two validation methods: DNS validation and email validation. Each has its own mechanics, prerequisites, and failure points.

DNS validation works by asking you to create a specific CNAME record in your domain's DNS zone. ACM provides you with the exact record name and value. Once you create this record and it propagates through the DNS system, ACM polls the DNS infrastructure to confirm the record exists. If everything aligns, validation succeeds and your certificate is issued.

Email validation, by contrast, works the traditional way: ACM sends confirmation emails to registered administrative addresses for your domain. You click a link in one of those emails to confirm you own the domain. It's simpler in some ways but depends entirely on email deliverability and your ability to access the right mailbox.

Both methods have advantages and failure modes. Understanding the differences and knowing what can go wrong at each step is essential for quick resolution.

### DNS Validation Failures and Solutions

DNS validation is the preferred method for most modern deployments, especially if your domain is hosted on Route 53. However, it's also where many troubleshooting scenarios emerge.

#### The CNAME Record Hasn't Propagated

This is the most common issue. ACM provides you with a CNAME record to add to your DNS zone, but sometimes the record takes longer to propagate than expected, or it's simply not been created yet.

When you request a certificate in the ACM console, you'll see a section called "Domains" with a "Create records in Route 53" button (if your domain uses Route 53). Clicking this button automatically creates the necessary CNAME record. If you're using a different DNS provider, you'll need to manually create the record yourself.

The propagation time varies. In ideal conditions, DNS changes propagate globally within minutes, but it can take up to 48 hours in rare cases. Most often, you'll see propagation within 5 to 15 minutes. The key is that ACM doesn't just check once; it polls periodically over several days. So even if the record isn't there immediately, ACM will eventually find it—unless something else is wrong.

To verify the record has propagated, use the `dig` or `nslookup` command from your terminal. For example, if ACM tells you to create a CNAME record named `_abc123.example.com`, you'd run:

```bash
dig _abc123.example.com CNAME
```

If the record exists, you'll see output showing the CNAME target ACM provided. If you see `NOERROR` with no answer section, the record hasn't propagated yet or doesn't exist. If you get `NXDOMAIN`, the domain itself isn't resolving correctly.

**The resolution:** Create the CNAME record if you haven't already, or wait for propagation if you have. Use `dig` to confirm it's live. If you used the "Create records in Route 53" button, the record should appear almost instantly in Route 53—check the hosted zone directly to verify.

#### Typos or Incorrect DNS Configuration

It's easy to make mistakes when manually entering DNS records, especially if the CNAME name or value is long and contains underscores or numbers that look similar.

ACM will generate a record name like `_abc123def456.example.com` and a target value like `_xyz789.acm-validations.aws.` (note the trailing dot). If you mistype either one, ACM won't find it during validation, and your certificate will remain pending indefinitely.

Another common error is accidentally modifying the record after creating it. Some DNS management interfaces make it easy to accidentally change a character or accidentally set a TTL (time-to-live) value that's too high.

**The resolution:** Double-check the record you created against what ACM specifies. Copy and paste values directly rather than typing them manually. Verify in the ACM console that it shows the exact same values you entered in your DNS provider. If there's a mismatch, delete the incorrect record and create a new one with the correct values.

#### Route 53 Hosted Zone Issues

If your domain is managed in Route 53 but ACM can't find the hosted zone, or you're looking in the wrong hosted zone, validation will fail.

This often happens when you have multiple hosted zones with similar names, or when the domain in your certificate request doesn't exactly match the zone name. For instance, if you request a certificate for `api.example.com` but your hosted zone is `example.com`, ACM will correctly create a CNAME record in the `example.com` zone. However, if your zone is actually named `api.example.com` (as its own separate zone), the record creation might fail or you might be looking in the wrong place.

Another scenario: you might have a hosted zone that's not active or associated with the right AWS account. If you're using multiple AWS accounts for different purposes, the certificate might be in one account while the hosted zone is in another.

**The resolution:** In the ACM console, after requesting a certificate, check the "Domains" section carefully. When you click "Create records in Route 53," ACM will show you which hosted zone it's creating records in. Verify this is the correct zone. If you don't see the expected hosted zone listed, it might not exist or might be in a different account. Create or verify the hosted zone exists with the correct name, then try again. If you're managing DNS outside of Route 53, ensure you're creating the record in the correct zone at your DNS provider.

#### ACM Not Detecting the Record Due to Timing

Sometimes the record exists and is properly propagated, but ACM's polling hasn't happened yet, or there's a slight delay in ACM's detection mechanism.

ACM doesn't validate immediately. Instead, it polls the DNS infrastructure periodically. In most cases this takes anywhere from a few seconds to a few minutes, but occasionally there are delays. Additionally, if you create the record and then immediately refresh the ACM console, you might see the record hasn't been detected yet simply because ACM hasn't polled since you created it.

**The resolution:** Wait 5 to 10 minutes after creating the DNS record before assuming something is wrong. Then refresh the ACM console. If the status still shows "Pending validation," use `dig` to confirm the record is actually live in DNS. If it is, wait another 5 to 10 minutes. ACM will eventually detect it. If after 30 minutes to an hour the record is live in DNS but ACM still doesn't detect it, there might be another issue—move on to checking for typos or DNS configuration problems.

#### ACM Validation Failing Due to DNSSEC or Other DNS Configuration Issues

In rare cases, DNSSEC (DNS Security Extensions) or other advanced DNS configurations can interfere with ACM's ability to validate. Similarly, if your DNS zone has overly restrictive query policies or unusual configurations, ACM might struggle to retrieve the validation record.

**The resolution:** Check if DNSSEC is enabled on your domain. If it is, ensure it's properly configured. Consult your DNS provider's documentation if you've implemented custom query policies. For Route 53 specifically, DNSSEC shouldn't interfere, but if you've set up query logging or VPC associations, verify they're not blocking ACM's validation requests.

### Email Validation Failures and Solutions

Email validation is simpler mechanically but more vulnerable to external factors like spam filters and mail server issues.

#### Confirmation Email Marked as Spam

ACM sends validation emails from an AWS address. Depending on your email provider and spam filter settings, these emails might be caught by spam filters before you ever see them.

When ACM sends a validation email, it typically comes from an address like `noreply@awssecuritynotifications.com` or similar. Some aggressive spam filters block emails from AWS domains, especially if your organization doesn't explicitly whitelist them.

**The resolution:** Check your spam or junk folder for the validation email. If you find it, mark it as "not spam" in your email client, which helps train the filter. If you don't see it at all, check with your email administrator to see if there's a gateway-level filter blocking AWS domains. You can ask them to whitelist `awssecuritynotifications.com`. Alternatively, you can request that ACM resend the validation email from the certificate details page in the console.

#### Admin Addresses Not Receiving Mail

ACM sends validation emails to administrative addresses registered with your domain's WHOIS record. If those email addresses are outdated, non-functional, or no longer monitored, you won't receive the validation email.

Common scenarios include: the listed admin email is an old employee's address that's no longer active, the email address has a typo in the WHOIS record, or the email address is real but routes to a mailbox that's full or disabled.

Additionally, if you registered your domain through a registrar that offers WHOIS privacy protection, the registered admin address might be a proxy address, and you might not have access to it. In that case, you'll never receive the validation email unless you update the WHOIS record.

**The resolution:** Check your domain's WHOIS record to see what email addresses ACM used. You can do this through your domain registrar's control panel or by doing a WHOIS lookup online. If the addresses are outdated or wrong, update them in your registrar's system. If your registrar uses WHOIS privacy, disable it temporarily to expose the real admin email, update it if needed, and re-enable privacy afterward. Once WHOIS is updated, wait 24 to 48 hours for the changes to propagate, then request a new certificate.

#### Old WHOIS Data Causing Validation Email Delivery Failures

Even if you've updated your WHOIS information recently, the changes might not have propagated globally yet. WHOIS data isn't instantly replicated across all registrars and WHOIS servers worldwide.

Additionally, if you've changed email addresses in WHOIS but ACM is pulling from an older snapshot of WHOIS data, it might send the validation email to the old address.

**The resolution:** Wait 24 to 48 hours after updating WHOIS before requesting a certificate. This gives the changes time to propagate. If you've already requested a certificate and are waiting for the validation email, and you know you recently updated WHOIS, wait the full 24 to 48 hours before assuming the email won't arrive. If it still doesn't arrive, check if the old email address (the one previously listed in WHOIS) received it instead. This would confirm that ACM used cached WHOIS data. In that case, wait a bit longer and request the certificate again.

#### Email Address Typos in the Domain Registration

Sometimes the admin email address in WHOIS has a typo—perhaps a missing letter, a wrong domain, or a transposed character. ACM sends the validation email to whatever address is in WHOIS, so if there's a typo, it goes nowhere or to the wrong person.

**The resolution:** Check the WHOIS record for typos. If you find any, correct them in your registrar's control panel. Then request a new certificate.

### Checking Validation Status in the ACM Console

The ACM console provides several clues about what's happening with your certificate validation. Learning to read these clues will help you diagnose issues quickly.

When you view a certificate's details, you'll see a "Domains" section listing each domain and its validation status. For DNS validation, you'll see one of the following statuses:

- **Pending validation:** ACM hasn't yet detected the validation record. This is normal immediately after creating the record. If it persists beyond 30 minutes and the record is live in DNS, something is wrong.
- **Success:** The validation record was found and validation is complete. The certificate is either issued or being issued.
- **Failed:** ACM attempted to validate but couldn't find the record or detected an issue. The certificate request will not proceed.

For email validation, the status will indicate whether the confirmation email has been opened and the link clicked. You'll also see a timestamp of when the email was sent.

Additionally, the console shows a "Validation" tab with more details about the validation method and, for DNS validation, the exact CNAME record you need to create. This is invaluable for double-checking that you've created the correct record.

If a certificate is in a failed or pending state and you're unsure why, the certificate details page is your starting point. Look at the validation status for each domain, check which validation method is being used, and verify that the validation record or email address is correct.

### Best Practices to Avoid Validation Failures

Preventing validation failures is far easier than troubleshooting them. A few practices can save you significant headaches.

First, prefer DNS validation over email validation when possible. DNS validation is more reliable, doesn't depend on email infrastructure, and integrates seamlessly with Route 53. If your domain is on Route 53, use the "Create records in Route 53" button to let ACM automatically create the validation record. This eliminates manual entry errors.

Second, keep your WHOIS information current and accurate. Even if you use WHOIS privacy, ensure the proxy address or the underlying admin address is one you actively monitor. Outdated WHOIS data is a common source of validation email delivery problems.

Third, when using DNS validation with a non-Route 53 provider, copy and paste the record values directly from the ACM console into your DNS management interface. Avoid manual typing, which introduces typos.

Fourth, when requesting certificates for multiple domains or subdomains, use a single certificate with Subject Alternative Names (SANs) whenever possible rather than requesting separate certificates for each. This reduces the number of validations you need to manage and simplifies operations.

Finally, be patient. DNS propagation and email delivery have inherent delays. If something doesn't work immediately, wait a few minutes, verify the underlying issue (record exists in DNS, email is in your inbox or spam folder), and try again. Most validation issues resolve themselves within 5 to 30 minutes if the underlying configuration is correct.

### Conclusion

ACM certificate validation failures boil down to a handful of common culprits: DNS records that haven't been created or have typos, DNS propagation delays, email delivery issues, and outdated WHOIS data. By understanding how each validation method works and knowing where to look for problems, you can diagnose and resolve issues quickly.

When troubleshooting, start with the simplest checks: verify the DNS record exists using `dig`, confirm the WHOIS email address is correct and monitored, and allow adequate time for propagation and email delivery. Use the ACM console's validation status display to understand what's happening at each step. And when you're designing new deployments, favor DNS validation with Route 53, keep your domain information current, and avoid manual entry errors.

With these practices and troubleshooting strategies in your toolkit, certificate validation will become a straightforward part of your AWS deployment process rather than a source of frustration.
