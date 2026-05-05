---
title: "How to Move Your AWS SES Account Out of Sandbox Mode"
---

## How to Move Your AWS SES Account Out of Sandbox Mode

When you first create an Amazon SES account, AWS places it in sandbox mode by default. This protective measure is designed to prevent abuse and ensure responsible email sending. However, sandbox mode comes with significant restrictions that make it unsuitable for production workloads. If you're planning to send emails at scale or need to reach recipients outside a small allowlist, you'll need to request production access. Understanding how to navigate this process—and knowing what AWS expects from you—is essential for any developer working with SES in a real-world environment.

In this article, we'll walk through everything you need to know about moving out of sandbox mode: what restrictions you're currently operating under, how to prepare your account, what information AWS needs from you, and what happens after approval.

### Understanding SES Sandbox Mode and Its Limitations

Sandbox mode exists for good reason. When your SES account is new, AWS wants to verify that you're a legitimate sender with responsible practices. The restrictions are straightforward but consequential: you can only send email to verified email addresses or verified domains, you're limited to 200 emails per 24-hour period, and your maximum send rate is capped at 1 email per second.

These restrictions might seem tolerable for initial testing, and they are—that's precisely why they exist. You can verify a few test email addresses, send yourself confirmation codes, and validate that your integration with SES is working correctly. The problem arises when you actually want to use SES for its intended purpose: delivering emails to your users at scale.

Imagine you've built a SaaS application that needs to send password reset emails to thousands of users. In sandbox mode, you'd hit the 200-per-day ceiling in minutes. Or suppose you're running an e-commerce platform where customers receive order confirmations. You literally cannot deliver these to real customers while in sandbox mode because their email addresses aren't verified in your account—and you can't verify thousands of them individually.

This is where production access becomes necessary. Once approved, your account moves out of sandbox mode, and those restrictions lift. You'll still have sending limits (AWS starts you at 200 emails per day for new production accounts, then increases this quota based on your usage and reputation), but these are quotas you can request increases for, not hard walls.

### Preparing Your Account Before You Apply

The application process for production access is straightforward, but it works best when you've done your homework first. AWS wants to see that you're treating email seriously and that you've already implemented responsible sender practices.

Start by verifying your domain. While sandbox mode allows you to verify individual email addresses, production use almost always requires domain verification. This involves adding DNS records to prove you control the domain—specifically, DKIM (DomainKeys Identified Mail) and SPF (Sender Policy Framework) records that AWS provides. Domain verification is more robust than email verification because it's harder to spoof and demonstrates that you're a legitimate organization behind that domain. If you're going to be sending emails on behalf of your company or service, verify your sending domain now, before you apply for production access.

Next, set up bounce and complaint notifications. This is not just preparation; it's essential infrastructure. AWS uses Simple Notification Service (SNS) to inform you when recipients mark your emails as spam (complaints) or when emails bounce. You need to handle these notifications gracefully—complaints should immediately suppress that recipient from your mailing list, and bounces should be categorized (permanent hard bounces mean the address is invalid; temporary soft bounces might recover). Setting up these notifications before applying shows AWS that you understand email best practices and are committed to maintaining sender reputation.

Here's what the setup looks like conceptually: you create an SNS topic for bounces and another for complaints, then configure SES to publish to these topics. From there, you can subscribe a Lambda function, an HTTP endpoint, or even an email address to these topics. Many developers choose Lambda because it integrates cleanly with their application's database, allowing them to automatically suppress problematic addresses.

You should also document your opt-in process. How do recipients end up on your mailing list? If you're sending marketing emails, you must have an explicit opt-in mechanism. If you're sending transactional emails (order confirmations, password resets, etc.), the opt-in is implicit—but you still need to explain this clearly. AWS takes a hard line on sending unsolicited email, and they'll reject applications from senders who can't articulate a clear, permission-based approach.

### Crafting a Strong Application Request

When you're ready, you'll submit a production access request through the AWS Support console. This isn't a form with drop-down menus; it's a free-tier support case where you explain your use case in your own words. The quality of your application matters more than you might expect. AWS reviews these manually, and a well-articulated request significantly improves your chances of approval.

Your application should address several key areas. First, describe your use case clearly and concretely. Rather than saying "I need to send emails to users," explain something like: "My e-commerce platform sends transactional emails including order confirmations, shipping notifications, and password resets to approximately 5,000 customers per month. I own the domain example.com and will be sending from noreply@example.com."

This matters because it gives AWS context. They want to know whether you're running a legitimate business, whether you understand the volume of email you'll be sending, and whether you're being honest about your intentions. Vague applications raise red flags.

Next, specify your expected sending volume. Be realistic here. Don't claim you'll send 100,000 emails per month if your actual forecast is 10,000—you can always request a quota increase later. Conversely, don't lowball your estimate so aggressively that you'll immediately hit limits after approval and need to request increases. A honest, well-reasoned forecast shows AWS that you've thought through your business.

Describe your bounce and complaint handling process. Explain that you've set up SNS notifications to track these metrics and that you have a process to remove bounced addresses from your mailing list and suppress users who complain. If you're sending marketing email, be explicit about how you handle unsubscribe requests. Mention that you monitor your bounce rate and complaint rate and that you understand poor sender reputation can lead to account suspension.

If you're planning to send marketing email (newsletters, promotions, etc.), clearly explain your opt-in mechanism. How did recipients consent to receive these emails? If you acquired a list from a third party, explain why you believe that list is legitimate and permission-based. If you're planning to import recipients from another email service, describe that process. AWS has been burned by spammers before, so they're particularly cautious about marketing use cases.

### Common Reasons for Rejection and How to Avoid Them

Not every application gets approved on the first try. Understanding why some get rejected helps you avoid those pitfalls.

The most common reason for rejection is insufficient detail or unclear use case. An application that says "I need to send emails" without further context signals to AWS that you haven't thought things through. Rejections like this come with feedback, and you can reapply after addressing the concerns. The second application is usually approved if you take the feedback seriously.

Another frequent rejection reason is vague or missing bounce and complaint handling. If your application doesn't mention any mechanism for handling these, AWS assumes you'll simply ignore bounces and complaints, which damages sender reputation and violates email best practices. Be explicit: "I have configured SES to publish bounce and complaint notifications to an SNS topic, which triggers a Lambda function that updates our database to suppress the affected address from future sends."

Some applications get rejected because the use case is legitimate but the expected volume is unreasonably high for a new account. AWS might approve you for 10,000 emails per day but reject a request for 1 million per day if there's no demonstrated track record. That's not a permanent rejection—it's an invitation to start smaller and request increases as you build reputation.

Red flags that lead to rejections include anything that hints at unsolicited email, harvested lists, or purchased email databases. If your application suggests you're planning to send marketing email to people who didn't explicitly opt in, AWS will deny it. Similarly, if you mention that you're acquiring a list from a third party but can't articulate why that list is legitimate, expect rejection.

### What to Expect During the Approval Process

Approval timelines vary. Many applications are approved within 24 hours, but some take several business days if AWS has questions. AWS Support will contact you through the support case if they need clarification. Check your support case regularly, and respond promptly if they ask follow-up questions.

During this waiting period, you can continue testing in sandbox mode. Refine your email templates, test your integration with your application, and ensure that your bounce and complaint handling is working correctly. There's no harm in making sure everything is solid before you start sending to real production volume.

### After Approval: Your New SES Landscape

Once AWS approves your application, the change is immediate. The 200-email-per-day limit and the verified-addresses-only restriction are gone. You can now send emails to any address, at any volume (up to your approved quota).

Your initial quota as a new production account is typically 200 emails per day with a send rate of 14 emails per second. These numbers might sound like an increase compared to sandbox mode's 1 email per second, but the daily limit remains identical. The key difference is that you can request quota increases by submitting support cases, and AWS will grant them based on your sending reputation. If you maintain low bounce rates, low complaint rates, and steady sending patterns, AWS will increase your quotas over time.

You should also note that you're now subject to AWS SES's pricing. Sandbox mode is free (partly because the restrictions prevent real usage). Production sending costs money—typically a few cents per thousand emails, depending on your region and whether you're sending through the SES API or SMTP. This should factor into your business model.

Additionally, your sending domain now has reputation implications. Poor sender behavior—high bounce rates, high complaint rates, or erratic sending patterns—can damage your domain's reputation. In extreme cases, AWS can suspend your account if they receive complaints from ISPs about your sending patterns. This isn't meant to frighten you; it's simply a reality of sending email at scale. Responsible practices keep you safe.

### Key Practices to Maintain Production Good Standing

Once you're approved and sending in production, a few practices will keep you in AWS's good graces and ensure your emails reach inboxes.

Monitor your bounce and complaint rates obsessively. AWS provides a reputation dashboard in the SES console that shows these metrics. Aim for a bounce rate under 5% and a complaint rate under 0.1%. If either metric starts trending upward, investigate the cause. High bounces often mean your list quality is declining; investigate whether you're sending to stale addresses. High complaints usually indicate that recipients aren't expecting the email you're sending.

Implement list hygiene practices. Remove addresses that bounce, especially permanent bounces. If someone marks your email as spam, don't send them anything else. If someone unsubscribes, honor that immediately. These practices aren't just best practices for maintaining good standing with AWS; they're fundamental to responsible email sending.

Maintain consistent sending patterns. AWS's abuse prevention systems look for sudden spikes in volume or irregular sending behavior. If you usually send 10,000 emails per day but suddenly jump to 500,000, AWS's systems might temporarily throttle or review your account. If you're planning a major sending campaign, contact AWS support beforehand to give them a heads-up.

Set up CloudWatch alarms for bounce rates and complaint rates. If either metric exceeds your thresholds, be notified immediately so you can investigate. Catching problems early prevents small issues from becoming account-threatening situations.

### Conclusion

Moving your SES account out of sandbox mode is a straightforward process when you understand what AWS is looking for. The application isn't pass-fail; it's a conversation where AWS wants to understand your use case and verify that you're a responsible sender. By preparing your account with domain verification and bounce/complaint handling, by crafting a clear and honest application, and by maintaining good sending practices after approval, you'll not only get approved—you'll build a reputation that allows you to send at the scale your business requires.

The sandbox exists to protect both AWS and the broader email ecosystem from abuse. Respecting that intent, demonstrating responsibility in your application, and maintaining those practices after approval ensures that you can use SES confidently and reliably as your application grows.
