---
title: "Cognito Advanced Security Features: Risk Configuration and Compromised Credentials"
---

## Cognito Advanced Security Features: Risk Configuration and Compromised Credentials

Building applications with user authentication is one of those deceptively complex problems that looks straightforward until you realize how many ways things can go wrong. A leaked password here, a credential stuffing attack there, or a user's account accessed from an impossible location—these aren't hypothetical edge cases anymore. They're real threats that happen daily across the internet.

This is where Amazon Cognito's advanced security features come in. Beyond basic password policies and multi-factor authentication, Cognito provides a sophisticated toolkit for detecting and responding to suspicious account activity in real time. In this article, we'll explore how Cognito's risk configuration and compromised credentials detection work together to create a layered defense that adapts to threats automatically.

### Understanding Cognito's Advanced Security Model

Amazon Cognito's standard authentication flow gets you a long way, but it operates with a somewhat passive posture. It verifies credentials, validates tokens, and trusts that if the right password was entered, the user is who they claim to be. Advanced security features flip this assumption on its head by asking: "Given everything we know about this user's historical behavior, does this sign-in look legitimate?"

Advanced security is optional and comes with additional costs per month for each user pool that has it enabled. This pricing model reflects the reality that these features require continuous background processing—analyzing sign-in patterns, maintaining historical data, and running risk assessment algorithms. It's worth understanding this cost-benefit tradeoff upfront. For applications with stringent compliance requirements or handling sensitive data, the cost is typically negligible compared to the security value. For hobby projects or development environments, you might choose to enable it selectively.

The core of Cognito's advanced security revolves around three interconnected mechanisms: risk configuration, which defines the rules for detecting suspicious activity; compromised credentials detection, which identifies users whose passwords have been exposed; and Lambda triggers, which let you respond programmatically to detected risks.

### Risk Configuration: Three Detection Mechanisms

Cognito's risk configuration gives you granular control over what constitutes suspicious behavior. It operates across three primary detection mechanisms, each of which can be independently enabled, disabled, or fine-tuned.

#### Impossible Travel Detection

Imagine a user logs in from New York at 2 PM, and then attempts to log in from London 30 minutes later. Without a supersonic jet, this is physically impossible. Impossible travel detection flags this by tracking the geographic location of each sign-in and calculating whether the distance between consecutive logins could reasonably be covered in the time elapsed.

Cognito determines location by analyzing the IP address used for authentication. The system maintains a history of sign-ins and their associated geolocation data. When a new authentication attempt arrives, it calculates the distance from the previous known location and compares it against the time elapsed. If the required travel speed exceeds reasonable limits (typically around 900 km/hour), the sign-in is flagged as a risk event.

The practical benefit here is catching compromised credentials quickly. If an attacker in a different country has obtained a user's password and is attempting account takeover, impossible travel detection will almost certainly fire—assuming the legitimate user isn't actually traveling.

One important caveat: geolocation based on IP address is inherently imprecise. VPNs, proxies, and corporate networks can skew location data. CDNs might route requests through unexpected paths. This is why impossible travel detection is one of several signals rather than a definitive proof of compromise. Cognito treats it as a risk factor to be weighed alongside other indicators.

#### Unusual Location Detection

While impossible travel catches dramatic geographic jumps, unusual location detection works differently. It identifies sign-ins from locations where the user has never authenticated before, based on their historical pattern.

When you enable unusual location detection, Cognito builds a profile of "known locations" for each user—essentially recording where they typically sign in from. This requires some baseline data. The system typically needs several sign-ins before it can meaningfully distinguish between usual and unusual locations. Once established, when a user authenticates from a genuinely new location, the system flags it.

This is subtly different from impossible travel. A user who relocates their home office from Boston to Austin wouldn't necessarily trigger impossible travel (they had several hours to travel), but they would trigger unusual location if they sign in from Austin before Cognito has recorded that as a known location.

The adaptive nature of this detection is important. Cognito regularly refreshes its understanding of user locations. If someone genuinely moves or travels frequently, the system gradually recognizes new locations as "normal" for them. This prevents alert fatigue for legitimate users while catching actual compromise early.

#### Brute Force Protection

Brute force attacks are straightforward but effective: an attacker repeatedly tries different passwords against a known username, hoping one will work. Cognito's brute force protection monitors authentication attempts and flags accounts experiencing repeated failed logins.

When you enable brute force protection, Cognito tracks failed authentication attempts per user account. If the number of failed attempts exceeds a configurable threshold within a time window, the account is temporarily blocked from further authentication attempts. The block is usually time-based—for example, after five failed attempts, the user cannot attempt again for 15 minutes.

This is remarkably effective because most legitimate users don't make repeated failed authentication attempts. They either know their password or they use the "forgot password" flow. Attackers, by contrast, are likely to make many attempts in rapid succession.

One implementation detail worth noting: Cognito distinguishes between failed attempts due to wrong credentials versus other failures. A failed MFA challenge won't increment the brute force counter in the same way as an incorrect password, because the user at least proved they knew the correct password.

### Compromised Credentials Detection

Compromised credentials detection addresses a different threat vector: passwords that have been exposed in third-party breaches but the user hasn't yet realized their credential is compromised. This is where Cognito's integration with external security data sources becomes powerful.

Cognito maintains a list of credentials known to be compromised from public security incidents, breaches, and third-party threat intelligence feeds. When a user attempts to sign in using their username and password, Cognito can check whether that exact credential pair appears in known breach databases.

If a match is found, the user is flagged for a mandatory password reset on their next successful authentication. This isn't a block—the user can still complete the current sign-in—but immediately upon successful authentication, they're prompted to change their password before accessing the application.

#### The Mechanics of Compromised Credentials

The compromised credentials list isn't a simple static file. Cognito uses sophisticated hashing and cryptographic techniques to check credentials against breach databases without storing passwords in plaintext or exposing the list to public access. The exact mechanisms are vendor-specific and not publicly documented in great detail, but the principle is sound: Cognito can detect compromised credentials without actually storing your users' passwords anywhere.

When compromised credentials detection is enabled, every authentication event goes through this check. If your user pool has thousands of users, this could mean millions of credential checks per month. AWS handles this infrastructure transparently—you don't need to manage the database or queries yourself.

#### Responding to Compromised Credentials

What happens when a compromised credential is detected? The user successfully authenticates, but their auth tokens carry a special flag indicating that a password reset is required. When the user attempts to call any API endpoint in your application, you can detect this flag and redirect them to a password reset flow.

Here's what that looks like in practice: a user signs in with their compromised password. Cognito returns authentication tokens. Your mobile app or web application checks the token attributes and sees the flag indicating a forced password reset. Rather than allowing full access, you present the user with a password change form, which they must complete. Only after successfully changing their password can they proceed with normal application use.

This approach balances security with user experience. Users aren't locked out, which would be frustrating if they're not aware their credential was compromised. Instead, they're nudged toward remediation in a way that feels natural—similar to many modern applications' "change your password" flows after detecting suspicious activity.

### Adaptive Authentication and Risk Response

Now that we've covered how Cognito detects risks, let's discuss what to do about them. This is where the flexibility of Cognito's architecture really shines.

When a risk event is detected, you have several options for how to respond. The action depends on the severity of the risk and your application's security requirements. Cognito categorizes risk events into three levels: low, medium, and high. You can configure your user pool's risk configuration to define the response for each level.

**Block**: The sign-in attempt is rejected outright. The user receives an authentication failure and cannot proceed. This is appropriate for high-severity risks—for example, a sign-in from a location that's geographically impossible to reach.

**Challenge**: The user must complete an additional verification step before authentication succeeds. This is typically MFA—they might receive a code via SMS or email that they must enter. It's a middle ground: the sign-in isn't immediately rejected, but an extra verification barrier is introduced.

**No risk**: The sign-in is allowed to proceed without additional friction. This might seem counterintuitive for a detected risk, but in practice, you might enable a low-risk action and then use Lambda triggers to log the event or send an internal alert rather than bothering the user.

### Lambda Triggers: Custom Risk Response Logic

Here's where Cognito's security truly becomes powerful: Lambda triggers allow you to execute custom code in response to risk events, giving you complete control over security policies.

Cognito provides several trigger points relevant to advanced security. The **user risk exception** trigger fires when a risk event is detected that would normally result in a block or challenge. This gives you a chance to inspect the risk event details and make a custom decision. You might, for example, check an internal user database to see if this user has indicated they're traveling, and if so, allow the sign-in despite the unusual location.

The **custom message** trigger fires when Cognito is about to send an SMS or email to the user—for example, to deliver a challenge code. You can intercept this and customize the message, add additional context, or even route it through an external service.

Here's a concrete example. Imagine you want to implement custom logic: if a user triggers a risk event but has premium account status, challenge them with MFA rather than blocking outright. A Lambda trigger lets you implement exactly this:

```python
def handler(event, context):
    # event contains the risk event details and user attributes
    user_attributes = event['request']['userAttributes']
    risk_level = event['request']['riskEventType']
    
    # Check custom database for premium status
    if user_attributes.get('custom:account_tier') == 'premium':
        # Override default action - use challenge instead of block
        return {
            'autoConfirmUser': False,
            'autoVerifiedAttributes': [],
            'claimsOverrideDetails': {
                'claimsToOverride': [],
                'claimsToSuppress': [],
                'userAttributesToOverride': {},
                'finalUserStatus': 'CONFIRMED'
            }
        }
    
    # For standard users, enforce the default risk action
    return event
```

This example is simplified, but it illustrates the point: you can write any logic you want and have it executed in response to detected risks. This is where generic security platforms give way to truly customized policies aligned with your specific business requirements.

Another common use case is enhanced logging. You might want to send all risk events to a SIEM system, or store them in DynamoDB for later analysis:

```python
def handler(event, context):
    import json
    import boto3
    
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table('SecurityEvents')
    
    # Log the risk event
    table.put_item(Item={
        'userId': event['request']['userAttributes']['sub'],
        'riskEventType': event['request']['riskEventType'],
        'timestamp': int(time.time()),
        'ipAddress': event['request']['ipAddress'],
        'deviceKey': event['request'].get('deviceKey', 'unknown'),
        'eventDetails': json.dumps(event)
    })
    
    return event
```

With Lambda triggers, you're not constrained by Cognito's built-in responses. You can call external APIs, check internal databases, implement multi-factor authentication flows with custom code, or trigger incident response workflows.

### Integration with Third-Party Security Services

While Cognito's built-in compromise detection is robust, some organizations use it alongside external security platforms. AWS integrates with third-party identity security providers, allowing you to augment Cognito's detection with signals from other sources.

This might involve calling an external risk assessment API from a Lambda trigger, or ingesting threat intelligence from third-party sources and storing it in DynamoDB where your Lambda can access it. For example, you might use a service that tracks leaked credentials from the dark web and cross-reference those against your user base.

The architecture looks like this: Cognito detects an authentication attempt, Lambda trigger fires, your function calls the third-party API to get additional risk assessment, and based on the combined signals, you make a final decision. This layered approach can catch attacks that any single system might miss.

### Cost and Operational Implications

Advanced security features in Cognito carry real costs that should factor into your decision. AWS charges per user per month for advanced security—roughly $0.02 per user monthly at the time of writing, though you should verify current pricing. For a user pool with 100,000 users, that's about $2,000 monthly just for the advanced security features.

This matters because unlike compute resources that you can scale up and down, Cognito's advanced security is priced on a per-user basis regardless of actual usage. If you have inactive users in your user pool, you're paying for security analysis on accounts that never sign in.

The operational implications extend beyond cost. Enabling these features means setting up Lambda triggers to handle risk events, configuring appropriate challenge and block thresholds, and monitoring the effectiveness of your policies. A poorly configured risk policy might block legitimate users at high rates, degrading the experience. Too lenient, and you lose the security benefits.

There's also the data retention aspect. Cognito maintains historical sign-in data to detect unusual locations and impossible travel. This data is kept for a limited time, but you should understand the retention period and how it affects policy effectiveness. A user who signs in once a month from their home office, then travels for a week, might legitimately trigger unusual location detection. You need policies that account for these realistic usage patterns.

### Best Practices for Advanced Security Configuration

Based on the mechanisms we've covered, here are some principles worth following:

Start with anomaly detection rather than strict rules. Impossible travel and unusual location detection are powerful precisely because they're adaptive—they learn what's normal for each user rather than imposing rigid geographic restrictions. Brute force protection, being event-based, is less prone to false positives.

Use challenges before blocks. If you're uncertain about risk, challenge the user with an additional verification step. This preserves the ability to detect and respond to actual attacks while minimizing friction for legitimate users. Blocks should be reserved for high-confidence threats.

Implement Lambda triggers for business-specific logic. Cognito's built-in responses are solid defaults, but your application has context that Cognito doesn't. A user traveling abroad, an insider threat investigation in progress, or a major security incident might require policies that go beyond Cognito's standard configuration.

Monitor and iterate. Risk configuration isn't a set-and-forget feature. Track false positives—legitimate users being challenged unnecessarily—and adjust thresholds accordingly. Similarly, monitor whether you're catching real threats. If certain attack patterns consistently slip through your configuration, adjust your policies.

Combine multiple signals. Cognito's advanced security works best when you enable multiple detection mechanisms. Impossible travel alone might miss a compromise occurring in the user's actual location. Brute force protection alone won't catch account takeover via a leaked password. Together, they create overlapping coverage.

### Practical Scenario: Putting It Together

Let's walk through a realistic scenario to see how these pieces fit together.

Sarah is a user in your application. She typically signs in from her office in San Francisco during business hours. One evening, her password is exposed in a breach of an unrelated service. The attacker immediately attempts to use her credentials to access your application.

Here's what happens: The authentication request arrives from Moscow. Cognito's impossible travel detection immediately flags this—there's no way Sarah traveled from San Francisco to Moscow in the time since her last login. But before rejecting the request, Cognito's compromised credentials detection also activates. The password the attacker is using matches one in the known breach database.

At this point, multiple risk events are stacked. Your risk configuration is set to block high-severity events, but your Lambda trigger fires first. The trigger examines the event details, notes that it's outside business hours (unusual for Sarah), the location is genuinely new (triggering unusual location detection), and the credentials are compromised.

Your Lambda function checks an internal database and confirms Sarah isn't currently traveling. It also checks your company's travel policy system and sees no approved travel request for Moscow. The function makes the decision: block the sign-in and trigger an incident alert.

Meanwhile, Sarah is trying to log in from her home that evening and encounters an "authentication failed" error. She assumes she mistyped her password and tries again. Brute force protection doesn't activate because she's only made two attempts. She uses the "forgot password" flow instead.

When Sarah resets her password, your application detects that she previously had compromised credentials flagged and enforces a password change at next login. She goes through the MFA challenge, gets a code via SMS, and regains access with a new password.

The attacker's attempt was blocked. Sarah experienced a small amount of friction but was able to regain access. Your security operations team was alerted to investigate the unauthorized access attempt. The system worked as designed.

### Conclusion

Cognito's advanced security features represent a significant step beyond basic authentication. They shift from a passive "verify this credential" model to an active "does this sign-in look legitimate based on everything we know?" approach.

Risk configuration gives you the tools to detect suspicious patterns automatically. Compromised credentials detection extends your visibility into threats originating from third-party breaches. Lambda triggers empower you to implement business-specific policies and integrate with external systems. Together, these features create a flexible, adaptive security posture.

The tradeoff is cost and operational complexity. Advanced security isn't free, and configuring it well requires thought and iteration. But for applications handling sensitive data, requiring high security assurance, or operating in regulated industries, the investment is typically justified.

The key is remembering that advanced security is a toolkit, not a turnkey solution. The best security posture comes from understanding how these mechanisms work, configuring them appropriately for your threat model, and continuously monitoring and adjusting as you learn about real patterns in your user base. With that approach, Cognito's advanced security features become a powerful addition to your application's defenses.
