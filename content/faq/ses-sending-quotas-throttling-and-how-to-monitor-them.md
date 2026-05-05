---
title: "SES Sending Quotas, Throttling, and How to Monitor Them"
---

## SES Sending Quotas, Throttling, and How to Monitor Them

Imagine you've just built an application that sends transactional emails to your users. You test it locally, everything works perfectly, and you deploy to production with confidence. Then your first marketing campaign launches, and suddenly your send requests start failing with throttling errors. Your team scrambles, users complain about missing emails, and you're left wondering: why didn't anyone warn me about sending limits?

This scenario plays out more often than you'd think, and it stems from a fundamental misunderstanding about how Amazon SES manages capacity. Unlike many AWS services where you pay for what you use and scale seamlessly, SES operates under a quota system with both daily sending limits and instantaneous rate limits. Understanding these constraints—and how to monitor and work within them—is essential for any developer building email functionality on AWS.

In this article, we'll explore how SES quotas work, what happens when you exceed them, and the concrete steps you can take to monitor usage, plan for growth, and avoid the painful surprises that catch many developers off guard.

### Understanding SES Quotas and Sending Limits

When you first create an AWS account and start using SES, you don't get unlimited sending capacity right out of the box. Instead, AWS places you in the sandbox—a restricted environment where you can only send emails to verified identities (email addresses or domains you've confirmed you own). This is partly a fraud prevention measure and partly a gentle way of forcing you to think about capacity planning.

Once you request and receive sandbox exit approval, you gain access to production sending, but you're still subject to two types of quotas: the daily sending quota and the maximum send rate.

The **daily sending quota** is the total number of emails you can send in a 24-hour period. When you first exit the sandbox, AWS typically grants you a daily quota of 200 emails per day. This might sound restrictive if you're imagining a high-volume application, but it's actually a reasonable starting point. AWS doesn't want spammers suddenly flooding the internet with millions of emails from new accounts, so they start conservative.

The **maximum send rate**, on the other hand, is about instantaneous throughput. This is measured in emails per second (or sometimes calls per second, depending on how you're sending). Your initial rate limit might be something like 1 email per second. Again, this is deliberately modest. The idea is that you prove you can send email responsibly at small scale before AWS trusts you with higher volumes.

Both of these quotas can be raised through the Service Quotas console, but they're not automatically increased. You have to request an increase, and AWS reviews your request based on factors like your sending reputation, complaint rates, bounce rates, and how long you've been sending emails.

### Checking Your Current Quotas and Usage with GetSendQuota

The first practical step in managing your SES quotas is actually knowing what they are and how much of them you've already consumed. AWS provides the `GetSendQuota` API action for exactly this purpose, and it's remarkably simple to use.

When you call `GetSendQuota`, AWS returns three pieces of information: your maximum send rate (emails per second), your daily quota, and your current 24-hour send count. This snapshot tells you whether you're approaching your limits and whether you need to start planning for a quota increase.

Here's what that looks like in practice using the AWS SDK for JavaScript:

```javascript
const sesClient = new SESClient({ region: 'us-east-1' });
const command = new GetSendQuotaCommand({});

try {
  const response = await sesClient.send(command);
  console.log('Max Send Rate:', response.MaxSendRate, 'emails/second');
  console.log('Max 24-Hour Send:', response.Max24HourSend, 'emails');
  console.log('Sent in Last 24 Hours:', response.SentLast24Hour, 'emails');
} catch (error) {
  console.error('Error retrieving quota:', error);
}
```

And here's the equivalent using the AWS CLI:

```bash
aws ses get-send-quota --region us-east-1
```

The output might look something like this:

```json
{
    "MaxSendRate": 1,
    "Max24HourSend": 200,
    "SentLast24Hour": 47
}
```

This tells you that you can send a maximum of 1 email per second, up to 200 total emails in any 24-hour period, and you've already sent 47 in the current window.

What makes `GetSendQuota` particularly useful is that you can call it regularly—perhaps once per hour or daily—and log the results to understand your sending patterns. Many teams set up a CloudWatch Events rule that triggers a Lambda function every hour to call `GetSendQuota`, store the results in DynamoDB, and then visualize the trend over time. This historical data becomes invaluable when you're deciding whether to request a quota increase or when you're troubleshooting unexpected spikes in email volume.

### CloudWatch Metrics: Your Window into Email Health

While `GetSendQuota` tells you about your quotas and daily volume, it doesn't tell you much about the health of your emails themselves. That's where CloudWatch metrics come in. SES publishes several metrics automatically to CloudWatch, and monitoring them is crucial for understanding your sending reputation and catching deliverability problems before they spiral.

The most critical metrics to monitor are **Send**, **Reputation.BounceRate**, and **Reputation.ComplaintRate**.

The **Send** metric is straightforward—it's the number of emails SES accepted and attempted to deliver in a given time period. This is useful for verifying that your application is actually sending what you think it's sending, and it provides a second data point (alongside `GetSendQuota`) for tracking your usage relative to your quota.

**Reputation.BounceRate** is the percentage of your emails that bounced. A bounce occurs when the recipient's mail server rejects the email, typically because the address doesn't exist or the mailbox is full. SES calculates this as a moving average, and while small numbers of bounces are inevitable, a consistently high bounce rate signals a problem—perhaps you're sourcing email addresses from unreliable data, or you're not properly removing bounced addresses from your mailing list.

**Reputation.ComplaintRate** is even more critical. This is the percentage of your emails that resulted in complaint feedback loops—meaning the recipient clicked "This is spam" in their email client. AWS and email service providers take complaint rates very seriously because high complaint rates indicate you're sending unwanted email. If your complaint rate exceeds 0.1% (one complaint per 1,000 emails), SES will pause your account's ability to send until you investigate and demonstrate that you've fixed the issue.

Here's how you might query these metrics using the CloudWatch API:

```javascript
const cloudwatchClient = new CloudWatchClient({ region: 'us-east-1' });

const params = {
  MetricName: 'Send',
  Namespace: 'AWS/SES',
  StartTime: new Date(Date.now() - 86400000), // Last 24 hours
  EndTime: new Date(),
  Period: 3600, // 1 hour
  Statistics: ['Sum']
};

const command = new GetMetricStatisticsCommand(params);
const response = await cloudwatchClient.send(command);
console.log('Send metrics:', response.Datapoints);
```

Beyond these three, SES also publishes metrics for Delivery, Open, Click, Reject, and Rendering Failure. While these are valuable for understanding email engagement and technical failures, the Send, BounceRate, and ComplaintRate metrics are the ones that directly affect your ability to keep sending email.

A best practice is to set up CloudWatch alarms on your complaint rate and bounce rate. For example, you might create an alarm that triggers if your complaint rate exceeds 0.05% (half your threshold) over a 6-hour period. This gives you early warning before you hit the hard 0.1% limit that causes AWS to suspend your sending.

### What Happens When You Exceed Your Rate Limit

Now let's talk about what actually happens when you run up against your limits. The two limits behave differently, which is important to understand.

If you exceed your **daily quota**—meaning you've already sent 200 emails today and you try to send the 201st—SES will reject your request immediately with a `MessageRejected` error. There's no queue, no waiting. The request fails, and it's your responsibility to handle that failure gracefully in your application code. This is why many teams implement a job queue for non-critical emails: if sending fails, the email goes back into the queue to try again later, perhaps the next day when the quota resets.

The **rate limit** is more nuanced. If you try to send faster than your maximum send rate allows—say you try to send 5 emails per second when your limit is 1 per second—SES will throttle you. Your request won't fail immediately; instead, it gets queued internally by SES, and you'll see a temporary slowdown in responses. However, if you keep hammering SES with requests faster than the rate limit, you'll eventually hit the throttle and receive a `Throttling` error, which AWS documents as a temporary issue that you should retry.

This is where the AWS SDK's built-in retry logic becomes your friend. The SDK for most languages includes exponential backoff retry logic out of the box. When you receive a throttling error, the SDK automatically waits a bit, then retries your request. It increases the wait time exponentially with each retry, backing off gradually until the request eventually succeeds or you exceed a maximum retry count.

Here's a simplified illustration of what that looks like:

```javascript
// The SDK handles retries automatically for throttling errors
// But here's what's happening under the hood

async function sendEmailWithBackoff(emailParams, maxRetries = 3) {
  let delayMs = 100; // Start with 100ms
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await sesClient.send(new SendEmailCommand(emailParams));
      return response;
    } catch (error) {
      if (error.name === 'Throttling' && attempt < maxRetries - 1) {
        console.log(`Throttled. Waiting ${delayMs}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        delayMs *= 2; // Exponential backoff
      } else {
        throw error;
      }
    }
  }
}
```

In practice, you rarely need to implement this yourself because the SDK does it for you, but understanding what's happening is crucial. If you're seeing persistent throttling errors, it means your application is consistently trying to send email faster than your quota allows, and you need to either slow down your sending rate or request a quota increase.

### Requesting a Quota Increase

When you've demonstrated responsible sending behavior and you're ready to scale, you'll need to request a quota increase. This is done through the AWS Service Quotas console, not the SES console.

To request an increase, navigate to the Service Quotas console, search for SES, and you'll see your various quotas listed: "Daily Sending Quota" and "Maximum Send Rate" are the two you'll typically care about. Click on one of them, and you'll see a button to "Request quota increase." You specify the new desired value, and AWS sends your request to a review queue.

AWS doesn't have a fixed timeline for approving quota increase requests, but in practice, modest increases (say, from 200 to 10,000 daily sends, or from 1 to 10 emails per second) often get approved within hours or a day. Larger increases may take longer because they warrant more scrutiny.

What AWS looks at when reviewing your request includes your sending reputation (bounce and complaint rates), the age of your sending identity, and the trend in your sending volume. If you're trying to go from 200 to 1 million emails per day overnight, and you've only been sending for a week, AWS will be skeptical. On the other hand, if you've been sending consistently with excellent metrics for months and you're making a reasonable request, approval is likely.

This is why the practice of "warming up" a sending identity—gradually increasing your sending volume over time—is so important.

### Warming Up a New Sending Identity

When you first request sandbox exit approval or when you add a new domain to SES, you should warm it up gradually. Warming up means slowly increasing your sending volume and closely monitoring your metrics throughout the process.

Here's why this matters: if you add a new domain to SES and immediately start sending a million emails from it, mailbox providers like Gmail and Outlook get nervous. They don't know if this domain is legitimate or if it's been compromised by a spammer. Their filtering algorithms make decisions based partly on reputation, and sudden spikes in volume from unknown senders trigger spam filters. You might find that your emails go straight to the spam folder, or worse, mailbox providers might start rejecting your mail entirely.

A typical warming schedule might look like this: on day one, send 100 emails. On day two, send 500. On day three, send 2,000. By the end of the first week, you might be sending 50,000 emails per day, and by the end of the second week, you're approaching your full intended volume. Throughout this process, you're monitoring your bounce rate and complaint rate closely. If they stay low (below 0.05% for bounces, negligible for complaints), you know your sending reputation is healthy and you can continue ramping up.

During the warming period, it's also a good idea to send primarily to engaged recipients—people who have opted in to receive email from you and who actively engage with your messages. Avoid sending to old, inactive lists or cold audiences during this time.

Many organizations create a simple spreadsheet that maps day-of-week to target volume, and they configure their sending application to deliberately throttle itself to stay below that target. This isn't just about following best practices; it's about protecting your sender reputation and ensuring good deliverability.

### Practical Capacity Planning

Let's tie this all together with a practical example. Suppose you're building an e-commerce application that needs to send transactional emails (order confirmations, shipping notifications, password resets) and you're expecting to grow from 1,000 users initially to 100,000 users over the next year.

Start by estimating your email volume. If each user triggers an average of 2-3 transactional emails per month, you're looking at roughly 2,000-3,000 emails per month, or 67-100 per day initially. This easily fits within the default 200 emails per day quota, so you don't need a quota increase yet.

However, you should still set up monitoring. Create a CloudWatch dashboard that displays your Send metric, bounce rate, and complaint rate. Set alarms on your complaint rate (trigger at 0.05%) and bounce rate (trigger at 5%). Call `GetSendQuota` once per day and log the result so you can track when you're approaching your limit.

As your user base grows, you'll notice your daily send volume creeping up. When you consistently hit 180 out of 200 daily emails, it's time to request a quota increase to, say, 1,000 per day. Make the request, and while you're waiting for approval, ensure your sending rate (emails per second) is under your maximum rate limit. If you're distributing 1,000 emails fairly evenly throughout a 24-hour period, you're sending roughly 0.01 emails per second, which is well below even the initial 1 email per second limit.

As you scale further and start sending marketing emails in addition to transactional emails, your volume might climb to 50,000 per day. Now you're requesting a daily quota increase to 100,000, and you're also likely hitting your rate limit. You might have 50,000 emails to send in a batch job that runs once daily. If your rate limit is still 1 per second, sending 50,000 emails would take over 13 hours. You'd request a rate limit increase to 10 per second, bringing that batch down to about 90 minutes.

Throughout this growth, you're constantly monitoring your metrics, warming up new sending identities, and ensuring your bounce and complaint rates stay healthy. This is the responsible way to scale SES.

### Handling Quota Limits Gracefully in Code

Beyond just monitoring, your application code should be designed to handle quota limits gracefully. Here are a few patterns worth considering.

For non-critical emails (like weekly digest emails or promotional messages), implement a job queue. When SES rejects a request because you've hit your daily quota, catch the error, and re-queue the email for the next day. Tools like AWS SQS or a simple database table with a scheduled Lambda function to retry messages work well.

For critical emails (password resets, account verifications), you might prioritize them differently. You could mark them as high-priority in your queue and process them first, ensuring important emails get sent before marketing emails.

You might also implement rate limiting on the client side. If you know your rate limit is 5 emails per second, have your application deliberately wait 200 milliseconds between sends. This is more predictable than relying on SES to throttle you.

Here's a simple example of client-side rate limiting:

```javascript
class SESEmailQueue {
  constructor(maxEmailsPerSecond) {
    this.maxEmailsPerSecond = maxEmailsPerSecond;
    this.minDelayMs = 1000 / maxEmailsPerSecond;
    this.lastSendTime = 0;
  }

  async send(emailParams) {
    const now = Date.now();
    const timeSinceLastSend = now - this.lastSendTime;
    
    if (timeSinceLastSend < this.minDelayMs) {
      const delayNeeded = this.minDelayMs - timeSinceLastSend;
      await new Promise(resolve => setTimeout(resolve, delayNeeded));
    }
    
    this.lastSendTime = Date.now();
    return sesClient.send(new SendEmailCommand(emailParams));
  }
}

const queue = new SESEmailQueue(5); // 5 emails per second
await queue.send(emailParams); // This will automatically throttle
```

### Monitoring in Production

In a production environment, you want your SES quota and health metrics visible at a glance. Here are the key items to include in a CloudWatch dashboard:

Create a metric showing your 24-hour send count alongside your daily quota as a stacked area chart. This makes it immediately obvious when you're approaching your limit. Add a separate metric for your current send rate (emails per second) with your maximum rate limit as a threshold line. Include your bounce rate and complaint rate on the same dashboard with alarm states highlighted. Finally, add a number widget showing the output of your last `GetSendQuota` call, refreshed hourly.

Set up SNS notifications for critical alarms. If your complaint rate exceeds 0.1%, you want to know immediately so you can investigate before SES pauses your account. Similarly, if you're consistently hitting your rate limit, that's a signal that you need to either slow down your application or request an increase.

Consider setting up a daily or weekly report that summarizes your SES sending, including total emails sent, bounce rate, complaint rate, and current quota usage. This report can be automatically generated by a Lambda function and emailed to your operations team.

### Conclusion

SES quotas exist for good reasons: they protect the email ecosystem from spam and abuse, and they force you to think intentionally about email delivery rather than treating it as a fire-and-forget mechanism. While quotas can feel restrictive at first, understanding them and planning around them is straightforward.

The key takeaways are simple: know your quotas by calling `GetSendQuota` regularly, monitor your sending health through CloudWatch metrics (especially bounce and complaint rates), handle errors gracefully in your code, warm up new sending identities gradually, and request quota increases proactively before you hit your limits. Do these things, and you'll avoid the painful surprises that catch unprepared teams off guard.

As you build more sophisticated email systems, you'll find that careful quota management becomes second nature. And as your application scales, you'll appreciate the discipline that SES's quota system imposed early on—it forced you to build the monitoring and graceful error handling that makes your production system robust.
