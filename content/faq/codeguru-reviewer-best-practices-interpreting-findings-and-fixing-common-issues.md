---
title: "CodeGuru Reviewer Best Practices: Interpreting Findings and Fixing Common Issues"
---

## CodeGuru Reviewer Best Practices: Interpreting Findings and Fixing Common Issues

Every developer has experienced that moment: code that looks fine passes local testing, slips through a quick peer review, and then causes issues in production. Sometimes the problem is subtle—a potential null pointer dereference hiding in an edge case, a security misconfiguration that only becomes obvious in hindsight, or a performance bottleneck lurking in what appeared to be straightforward logic. This is where machine learning-powered code analysis becomes invaluable. Amazon CodeGuru Reviewer uses deep learning models trained on billions of code examples and Amazon's own internal best practices to automatically identify issues that humans might miss. But like any powerful tool, getting the most value from CodeGuru Reviewer requires understanding not just what it finds, but how to interpret those findings, distinguish signal from noise, and integrate the insights effectively into your development workflow.

### Understanding CodeGuru Reviewer's Role in Your Development Pipeline

CodeGuru Reviewer isn't a replacement for human code review or your existing linting and testing tools—it's a force multiplier that works alongside them. Traditional static analysis tools excel at finding syntax errors and straightforward pattern violations. CodeGuru Reviewer goes deeper, leveraging machine learning to detect issues that involve understanding code semantics, data flow, and architectural patterns. It catches the kinds of problems that require reading across multiple functions or understanding the intent behind a business-critical operation.

The service integrates directly with your source control systems, analyzing pull requests and commits in repositories you've connected through GitHub, GitHub Enterprise, Bitbucket, or AWS CodeCommit. When you enable CodeGuru Reviewer, it automatically scans new code changes and surfaces findings with explanations of why each issue matters and how to fix it. This happens asynchronously, so your development workflow isn't blocked while the analysis runs—though you can certainly choose to block merges based on critical findings if your risk tolerance requires it.

### The Three Categories of CodeGuru Reviewer Findings

CodeGuru Reviewer organizes its findings into three broad categories, each addressing different dimensions of code quality. Understanding these categories helps you triage findings more effectively and know which ones demand immediate attention.

**Potential bugs** represent logical errors that could cause incorrect behavior at runtime. These include null pointer dereferences, resource leaks, incorrect exception handling, infinite loops, and off-by-one errors. When CodeGuru Reviewer flags a potential bug, it's highlighting code that doesn't violate syntax rules but could fail under certain conditions. For instance, the service might detect that a variable is used without first checking if it's null, or that a database connection is opened but never closed under certain error paths. These findings tend to be actionable and worth taking seriously because they represent real threats to application stability.

**Security vulnerabilities** encompass everything from injection attacks and improper credential handling to insecure cryptographic practices and unsafe use of third-party libraries. CodeGuru Reviewer applies security expertise to flag patterns that could be exploited. This might include hardcoded secrets, SQL injection risks where user input isn't properly parameterized, or the use of deprecated and unsafe cryptographic algorithms. Security findings should almost always be addressed—the potential business impact of a security breach far outweighs any temporary slowdown in feature development.

**AWS best practices** findings are specific to applications running on AWS. These identify opportunities to use AWS services more effectively, improve resilience, optimize costs, or align with architectural patterns that Amazon recommends. Examples include suggesting more efficient ways to access AWS APIs, recommending the use of AWS SDK built-in retries instead of custom retry logic, or flagging services configured without multi-region resilience when the application context suggests it's needed. These findings are often valuable but sometimes context-dependent—what's a best practice in one scenario might be over-engineering in another.

### Interpreting Severity and Actionability

Every CodeGuru Reviewer finding comes with metadata that helps you prioritize effort. The severity level indicates the potential impact if the issue manifests in production. Findings are typically rated as Critical, High, Medium, or Low. This doesn't necessarily correlate directly to how easy they are to fix—a critical security vulnerability might take five minutes to remedy, while a low-severity architectural improvement might require significant refactoring.

More important than the severity label is understanding the actionability of a finding. An actionable finding is one where the fix is clear, low-risk, and directly addresses the underlying issue. Some of CodeGuru Reviewer's most valuable findings are of this type: they identify something concretely wrong and point toward a specific solution. A finding that a function always throws an exception before returning a value is highly actionable—you know exactly what to fix.

Other findings are less immediately actionable because they require judgment calls or deeper investigation. For example, CodeGuru Reviewer might flag that a particular method is complex and suggest breaking it down, which is good advice in general but might not be the right refactoring in your specific context. These findings benefit from team discussion and judgment before implementation.

Pay attention to the explanatory text CodeGuru Reviewer provides with each finding. The service doesn't just say "this is bad"—it explains the reasoning, often with examples of what could go wrong. Read this explanation carefully. It often clarifies whether a finding applies to your specific situation or whether it's a false positive that reflects a limitation in the analysis.

### Common False Positives and When to Suppress Findings

No automated analysis tool achieves perfect precision, and CodeGuru Reviewer is no exception. It will occasionally flag code that isn't actually problematic, and understanding when this happens helps you maintain confidence in the tool while avoiding review fatigue.

One common source of false positives involves context that the tool can't fully understand. Consider a function that processes a collection after checking its size:

```python
def process_items(items):
    if len(items) == 0:
        return None
    
    # CodeGuru Reviewer might flag the next line as potentially accessing
    # items[0] when items could be None, not understanding that we've
    # already verified items isn't empty
    first_item = items[0]
    return transform(first_item)
```

CodeGuru Reviewer might not fully track that the length check guarantees items isn't empty, and could flag the access to `items[0]` as potentially unsafe. This is a benign false positive—the code is actually safe given the guard clause, but the tool's analysis is too conservative.

Another source of false positives stems from intentional code patterns that violate typical best practices but are justified in context. For instance, you might intentionally use a mutable class member as a cache, synchronizing access through locks. CodeGuru Reviewer might flag mutable state as a concern without understanding your synchronization strategy. Or you might use recursion in a carefully bounded way that can never stack overflow, but the tool flags it as a risk.

Security findings can also produce false positives when your code uses AWS IAM roles, secrets managers, or other mechanisms that CodeGuru Reviewer's pattern matching doesn't fully recognize. For example, if you're reading a secret from AWS Secrets Manager rather than hardcoding it, that's secure—but if the tool doesn't see the explicit `get_secret_value()` call, it might falsely warn about credential handling.

When you encounter findings you believe are false positives, CodeGuru Reviewer allows you to suppress them. You can suppress findings at the repository level, for a specific file, or even inline in the code itself. Each suppression should include reasoning—this is partly for your future self when you revisit the decision, and partly for your team to understand why you're making exceptions.

Suppressing findings inline is particularly useful and professional. In Python, you might add a comment like:

```python
# CodeGuru Reviewer: Suppressed CRITICAL_SECURITY_MISCONFIGURATION because
# we're reading from AWS Secrets Manager, not hardcoding the credential
credentials = secrets_client.get_secret_value(SecretId='my-secret')['SecretString']
```

Or in Java:

```java
// codeguru-reviewer: suppress SuspiciousMutableStateMember - this field is
// intentionally mutable and guarded by synchronized access in getCachedValue()
private Map<String, Object> cache = new HashMap<>();
```

Use suppression judiciously. If you're suppressing dozens of findings, that's a signal that either the tool isn't well-configured for your codebase or your code has deeper issues. But suppressing a handful of well-justified exceptions is healthy and keeps the signal-to-noise ratio high for your team.

### Real-World Examples of Common Findings and How to Fix Them

Let's walk through some concrete examples of findings you'll encounter and the thought process for addressing them.

**Example 1: Resource Leak (Potential Bug)**

CodeGuru Reviewer flags this Python code:

```python
def read_config_file(filename):
    config_file = open(filename, 'r')
    config_data = json.load(config_file)
    return config_data
```

The finding: "File handle may not be closed if an exception occurs during JSON parsing."

The issue here is real. If `json.load()` raises an exception, the file handle leaks. The fix is straightforward—use a context manager:

```python
def read_config_file(filename):
    with open(filename, 'r') as config_file:
        config_data = json.load(config_file)
    return config_data
```

This ensures the file closes automatically, even if parsing fails. It's a minimal change that eliminates the risk entirely. This is exactly the kind of finding worth addressing immediately—it's actionable, the fix is safe, and it genuinely improves code reliability.

**Example 2: SQL Injection Risk (Security Vulnerability)**

CodeGuru Reviewer flags this Node.js code:

```javascript
async function getUserById(id) {
    const query = `SELECT * FROM users WHERE id = ${id}`;
    const result = await db.query(query);
    return result.rows[0];
}
```

The finding: "Potential SQL injection vulnerability. Use parameterized queries instead of string concatenation."

This is a critical security issue. An attacker could pass a malicious value for `id` that breaks out of the SQL statement and executes arbitrary code. The fix uses parameterized queries:

```javascript
async function getUserById(id) {
    const query = 'SELECT * FROM users WHERE id = $1';
    const result = await db.query(query, [id]);
    return result.rows[0];
}
```

Most database drivers support parameterized queries natively. In this case, the database library treats `$1` as a placeholder and handles escaping the `id` parameter automatically. Never interpolate user input directly into SQL strings—always use parameterized queries or prepared statements. This is non-negotiable from a security perspective.

**Example 3: AWS Best Practice Violation**

CodeGuru Reviewer flags this Java code:

```java
public class ConfigurationLoader {
    private final AmazonS3 s3Client;
    
    public ConfigurationLoader() {
        this.s3Client = AmazonS3ClientBuilder.standard().build();
    }
    
    public String loadConfig(String bucket, String key) {
        GetObjectRequest getObjectRequest = new GetObjectRequest(bucket, key);
        S3Object s3Object = s3Client.getObject(getObjectRequest);
        // ... process s3Object
    }
}
```

The finding: "Consider using the AWS SDK for Java v2 with built-in exponential backoff and automatic retries for improved resilience."

This isn't a bug—the code works. But CodeGuru Reviewer is suggesting that the SDK v2 is more modern, has better performance characteristics, and includes retry logic automatically. Over time, you should migrate to v2. However, if you're on a deadline or this is legacy code that works well, it's reasonable to suppress this finding for now. Unlike the security vulnerability, this is a "nice to have" improvement rather than something that threatens production stability.

**Example 4: Null Pointer Dereference Risk**

CodeGuru Reviewer flags this Python code:

```python
def extract_user_email(api_response):
    user_data = api_response.get('user')
    email = user_data['email']
    return email.lower()
```

The finding: "Potential null pointer dereference. `user_data` might be None."

The issue: if the 'user' key is missing from `api_response`, `.get('user')` returns `None`, and then `user_data['email']` fails. The fix depends on your intent:

```python
def extract_user_email(api_response):
    user_data = api_response.get('user')
    if user_data is None:
        return None  # or raise an exception, or return a default
    email = user_data.get('email', '')
    return email.lower()
```

Or more concisely with chaining:

```python
def extract_user_email(api_response):
    email = api_response.get('user', {}).get('email', '')
    return email.lower() if email else None
```

Which approach is right depends on your application's semantics. But the important thing is to handle the case explicitly rather than letting it fail with a cryptic error message.

### Integrating CodeGuru Reviewer into Your CI/CD Pipeline

CodeGuru Reviewer's power multiplies when you integrate it into your continuous integration and continuous deployment workflows. Rather than treating code review findings as optional feedback that developers can ignore, you can enforce policies that block problematic merges.

Most teams use a tiered approach. Critical security vulnerabilities should always block a merge—there's no legitimate reason to merge code with known exploitable flaws. Critical potential bugs might also block merges, depending on your risk tolerance and the maturity of your codebase. High-severity findings often block merges unless explicitly approved. Medium and low-severity findings typically don't block merges but are surfaced for the developer's consideration.

Setting this up in GitHub is straightforward. You can create a branch protection rule that requires CodeGuru Reviewer analysis to complete and pass before merging. In AWS CodePipeline, you can add a CodeGuru Reviewer stage that fails the pipeline if critical findings are detected.

Here's how you might configure this in a simple GitHub Actions workflow:

```yaml
name: Code Review
on: [pull_request]

jobs:
  codeguru:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
        with:
          fetch-depth: 0
      
      - name: Run CodeGuru Reviewer
        uses: aws-actions/codeguru-reviewer@v1
        with:
          build-context: ./
          s3-bucket: my-codeguru-bucket
      
      - name: Check for critical findings
        run: |
          # This script would parse CodeGuru output and fail if
          # critical findings are detected
          python check_findings.py
```

The key principle is this: make security and critical bug findings visible and actionable in your review process without creating so much friction that developers learn to ignore the tool. If every pull request surfaces hundreds of low-priority findings, developers tune it out. If you're selective and only block merges on findings that truly matter, the tool becomes trusted and valuable.

Many teams also use CodeGuru Reviewer's integration with AWS CodeCommit and pull requests to add comments directly on the code. When a reviewer sees CodeGuru Reviewer's suggestion alongside human comments, the suggestion carries more weight and makes discussion more concrete.

### Building Team Trust and Institutional Knowledge

The most successful deployments of CodeGuru Reviewer aren't those that treat it as an automated gatekeeper, but rather those where it becomes a learning tool for the team. When CodeGuru Reviewer flags a SQL injection risk, it's not just preventing a bug—it's teaching the developer about parameterized queries. When it flags a resource leak, it's reinforcing proper resource management patterns.

Create internal documentation that explains your team's policy for different finding categories. Establish conventions around when findings are suppressed and why. Share interesting findings in team channels or retrospectives—"Did you know CodeGuru caught this security issue that our human review missed?" builds institutional knowledge and helps the team improve over time.

Also be prepared to iterate on your CodeGuru Reviewer configuration. You can customize which types of findings are most relevant to your application. If you're building a real-time trading system, performance-related findings matter more. If you're building medical software, security and correctness findings matter most. Use the configuration options to tune the tool to your context.

### Handling False Negatives: What CodeGuru Reviewer Doesn't Catch

While it's important to understand when CodeGuru Reviewer produces false positives, it's equally important to recognize that the tool isn't perfect in the opposite direction. There are bugs and security issues it won't catch—this is inherent to any static analysis approach. CodeGuru Reviewer should be part of your defense-in-depth strategy, alongside unit tests, integration tests, security scanning tools, penetration testing, and human code review. It's exceptionally good at certain patterns but won't replace any of these other practices.

For example, CodeGuru Reviewer can detect obvious SQL injection risks but might miss subtle ones where the injection point is indirect or the dangerous code is hidden in a utility function. It can catch many security misconfigurations but not all of them—especially not those involving your specific business logic and threat model.

This is why the best teams use CodeGuru Reviewer as a force multiplier for human reviewers, not as a substitute for them. A human reviewer sees the full context of why a change is being made, can reason about the business impact, and can evaluate tradeoffs that static analysis can't appreciate. CodeGuru Reviewer is the tireless assistant that handles mechanical checks, freeing humans to focus on judgment calls and architectural decisions.

### Measuring the Impact of CodeGuru Reviewer

As you integrate CodeGuru Reviewer into your workflow, consider how you'll measure its impact. Track metrics like the number of findings detected, the distribution across severity levels and categories, and most importantly, the number of findings that are actually fixed before reaching production. Over time, you should see a decline in the number of security vulnerabilities and obvious bugs making it to production.

You can also measure developer productivity. Code reviews that include CodeGuru Reviewer insights often move faster because the mechanical checks are automated, allowing human reviewers to focus on higher-level concerns. Track the time from pull request creation to merge and see if it improves.

And don't overlook the confidence metric. Teams that use CodeGuru Reviewer effectively often report feeling more confident in their code quality and more comfortable deploying frequently. That confidence translates to reduced incident response time and fewer production firefighting sessions.

### Conclusion

CodeGuru Reviewer represents a meaningful shift in how we approach code quality. By bringing machine learning insights to the code review process, it catches classes of bugs and security issues that humans tend to miss, while freeing up human reviewers to focus on higher-level architectural and design concerns. The key to getting value from the tool isn't treating it as an oracle that's always right—it's understanding its strengths and limitations, configuring it thoughtfully for your team's context, and integrating it into your development process as a trusted teammate rather than an adversary.

The best practice is to start with visibility. Enable CodeGuru Reviewer on your repository and let findings flow in without enforcement. Review them, suppress the false positives, fix the genuine issues, and let your team develop intuition about what the tool catches well. Then, gradually tighten your policies—start blocking critical security findings, then critical bugs, then whatever else your risk profile demands. Build institutional knowledge around common findings and how to fix them. Over time, CodeGuru Reviewer becomes not just a safety net but a teaching tool that raises the code quality of your entire organization.
