---
title: "ECR Lifecycle Policies: Practical Examples to Control Storage Costs"
---

# ECR Lifecycle Policies: Practical Examples to Control Storage Costs

Every AWS developer who works with containerized applications knows the pain: your Elastic Container Registry starts accumulating images like a digital hoarder. Build after build, test after test, and suddenly you're paying for storage that's mostly dead weight. ECR lifecycle policies are your answer to this problem, but they're easy to misunderstand if you haven't worked with them before. In this article, I'll walk you through the mechanics of lifecycle policies, show you practical real-world examples, and teach you how to implement them safely without accidentally deleting images you actually need.

### Why ECR Lifecycle Policies Matter

When you're running a healthy CI/CD pipeline, you're pushing new container images constantly. If you don't have a cleanup strategy in place, your ECR repository will balloon in size, and so will your AWS bill. A single large image might be 500 MB or more. After a month of daily builds, you could easily have hundreds of gigabytes sitting around.

Lifecycle policies automate the cleanup process. Rather than manually deleting old or unused images, you define rules that tell ECR exactly which images to keep and which ones to delete. The policy engine evaluates these rules daily at midnight UTC, checking every image in your repository against your criteria and removing the ones that match your expiration conditions.

The beauty of lifecycle policies is that they're flexible enough to handle complex scenarios. You can keep your most recent images regardless of age, expire untagged images after a certain number of days, preserve production images while cleaning up development ones, and combine all these rules in a single policy with careful priority management.

### Understanding the Daily Evaluation Cycle

ECR lifecycle policies aren't evaluated in real-time. Instead, the policy engine runs once per day at midnight UTC. This means if you push an image at 11:59 PM UTC, it won't be evaluated against your lifecycle rules until the next evaluation cycle runs at midnight.

This daily cycle is important for two reasons. First, it prevents constant deletions from destabilizing your infrastructure. If a policy ran continuously, you might accidentally delete an image that's currently being deployed. Second, it gives you a predictable window to understand what's going to happen to your images.

When you first create a lifecycle policy, the engine doesn't immediately evaluate images that might already be expired. It only deletes images that match your rules during the next scheduled evaluation and subsequent daily runs. This is actually a safety feature—it means you can create a conservative policy without fear of immediate mass deletion.

### The Anatomy of an ECR Lifecycle Policy

An ECR lifecycle policy is a JSON document with two main parts: the rules array and the rule priority system. Each rule contains a selection criteria that identifies which images to act upon and an action that specifies what to do with matching images.

The most common action is `expire`, which deletes images. The selection criteria are where the logic lives. You can filter by image tag status (tagged vs untagged), by tag prefix pattern, by image age, by count, or by combinations of these. Rules are evaluated in order of their priority number, starting with 0. If an image matches multiple rules, the earliest rule in the sequence wins.

Here's the structure of a basic lifecycle policy:

```json
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Rule 1 description",
      "selection": {
        "tagStatus": "tagged",
        "tagPrefixList": ["prod-"],
        "countType": "imageCountMoreThan",
        "countNumber": 10
      },
      "action": {
        "type": "expire"
      }
    }
  ]
}
```

The `tagStatus` field accepts either `tagged`, `untagged`, or `any`. The `countType` can be `imageCountMoreThan` or `sinceImagePushed`. When you use `imageCountMoreThan`, you're saying "keep only this many images matching the criteria." When you use `sinceImagePushed`, you're saying "delete images that are older than X days."

### Example 1: Keep Only the N Most Recent Images

Let's start with a simple but powerful use case: you want to keep only the 10 most recent images in your repository, regardless of their age. This is useful for repositories where you're constantly building but don't need historical images.

```json
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Keep only 10 most recent images",
      "selection": {
        "tagStatus": "tagged",
        "countType": "imageCountMoreThan",
        "countNumber": 10
      },
      "action": {
        "type": "expire"
      }
    }
  ]
}
```

This rule says: "Look at all tagged images in the repository. If there are more than 10 of them, delete the oldest ones until only 10 remain." The rule processes from newest to oldest, so the most recent 10 tagged images are always safe.

Notice that we're specifying `"tagStatus": "tagged"`. This means we're only counting images that have at least one tag. If you wanted to include untagged images in this count, you'd change it to `"any"`, but typically you want to keep tagged images and clean up untagged ones separately.

### Example 2: Expire Untagged Images After a Time Period

Untagged images are orphaned—they're not part of any release or test artifact that matters anymore. A common strategy is to clean them up after they've sat around unused for a certain period.

```json
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Expire untagged images after 7 days",
      "selection": {
        "tagStatus": "untagged",
        "countType": "sinceImagePushed",
        "countNumber": 7
      },
      "action": {
        "type": "expire"
      }
    }
  ]
}
```

Here we're using `"sinceImagePushed"` with a count of 7, which means "delete images older than 7 days." The `"tagStatus": "untagged"` ensures we only target images without tags. This is a classic cleanup rule that safely removes build artifacts that never made it to a meaningful tag.

The number represents days, so `"countNumber": 7` means 7 days. If you want to be more aggressive, you could set it to 3 or even 1 day. If you want to be more conservative, 14 or 30 are reasonable choices.

### Example 3: Separate Rules for Production and Development Images

Real-world repositories often contain images for different environments. You might tag production images with `prod-*`, staging images with `staging-*`, and development images with `dev-*`. You probably want different retention policies for each.

```json
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Keep 50 most recent production images",
      "selection": {
        "tagStatus": "tagged",
        "tagPrefixList": ["prod-"],
        "countType": "imageCountMoreThan",
        "countNumber": 50
      },
      "action": {
        "type": "expire"
      }
    },
    {
      "rulePriority": 2,
      "description": "Keep 20 most recent staging images",
      "selection": {
        "tagStatus": "tagged",
        "tagPrefixList": ["staging-"],
        "countType": "imageCountMoreThan",
        "countNumber": 20
      },
      "action": {
        "type": "expire"
      }
    },
    {
      "rulePriority": 3,
      "description": "Keep 5 most recent dev images",
      "selection": {
        "tagStatus": "tagged",
        "tagPrefixList": ["dev-"],
        "countType": "imageCountMoreThan",
        "countNumber": 5
      },
      "action": {
        "type": "expire"
      }
    },
    {
      "rulePriority": 4,
      "description": "Expire all untagged images after 3 days",
      "selection": {
        "tagStatus": "untagged",
        "countType": "sinceImagePushed",
        "countNumber": 3
      },
      "action": {
        "type": "expire"
      }
    }
  ]
}
```

This policy creates a tiered retention strategy. Production images get the most space because they're most valuable and might be rolled back to. Staging images get moderate retention. Development images get minimal retention because they're ephemeral. Untagged images—which accumulate during builds that fail or during development—get cleaned up quickly.

The priority numbers matter here. The rules are evaluated in order from 1 to 4. Each image is checked against rule 1 first, then 2, then 3, and so on. If an image matches rule 1's criteria, it's either deleted or preserved based on that rule, and the remaining rules don't apply to it.

### Example 4: Multiple Tag Prefixes in a Single Rule

Sometimes you want to group multiple tag prefixes under the same retention policy. For example, you might have `release-1.x`, `release-2.x`, and `release-3.x` tags that should all follow the same rules.

```json
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Keep 30 most recent release images across all versions",
      "selection": {
        "tagStatus": "tagged",
        "tagPrefixList": ["release-1.", "release-2.", "release-3."],
        "countType": "imageCountMoreThan",
        "countNumber": 30
      },
      "action": {
        "type": "expire"
      }
    }
  ]
}
```

The `tagPrefixList` is an array, so you can include multiple prefixes. An image matches this rule if it has a tag starting with any of the prefixes listed. In this case, if an image is tagged `release-1.5.2`, `release-2.0.1`, or `release-3.1.0`, it would be included in the evaluation.

### Example 5: Complex Real-World Policy

Now let's build a comprehensive policy that handles a realistic scenario: a microservice team with production, staging, and development environments, plus daily builds and hotfixes.

```json
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Never delete production-released images",
      "selection": {
        "tagStatus": "tagged",
        "tagPrefixList": ["prod-release-"],
        "countType": "imageCountMoreThan",
        "countNumber": 100
      },
      "action": {
        "type": "expire"
      }
    },
    {
      "rulePriority": 2,
      "description": "Production hotfixes - keep 20 most recent",
      "selection": {
        "tagStatus": "tagged",
        "tagPrefixList": ["prod-hotfix-"],
        "countType": "imageCountMoreThan",
        "countNumber": 20
      },
      "action": {
        "type": "expire"
      }
    },
    {
      "rulePriority": 3,
      "description": "Staging releases - keep 15 most recent",
      "selection": {
        "tagStatus": "tagged",
        "tagPrefixList": ["staging-"],
        "countType": "imageCountMoreThan",
        "countNumber": 15
      },
      "action": {
        "type": "expire"
      }
    },
    {
      "rulePriority": 4,
      "description": "Development daily builds - keep 10 most recent",
      "selection": {
        "tagStatus": "tagged",
        "tagPrefixList": ["dev-"],
        "countType": "imageCountMoreThan",
        "countNumber": 10
      },
      "action": {
        "type": "expire"
      }
    },
    {
      "rulePriority": 5,
      "description": "Untagged images - expire after 2 days",
      "selection": {
        "tagStatus": "untagged",
        "countType": "sinceImagePushed",
        "countNumber": 2
      },
      "action": {
        "type": "expire"
      }
    }
  ]
}
```

This policy reflects how teams actually work. Production release images are kept generously because they're stable references. Hotfixes get moderate retention. Staging gets reasonable retention for testing. Development gets minimal retention because builds happen frequently. And untagged images—build artifacts from failed or test runs—get cleaned quickly.

### Understanding Rule Evaluation and Priority

The priority system is critical to understanding how policies work. When ECR evaluates images, it goes through the rules in order. The first rule an image matches determines its fate.

Consider an image tagged `prod-release-v1.5.0`. When the policy engine evaluates it, it checks rule 1: "Does this image have a tag starting with `prod-release-`?" Yes, it does. Rule 1 says to keep the 100 most recent images with this prefix. So the engine will either keep or delete this image based on whether there are more than 100 such images. Once this image has been processed by rule 1, rules 2, 3, 4, and 5 don't apply to it anymore.

Now consider an image tagged `dev-build-20240115`. When evaluated, rule 1 doesn't match (wrong prefix). Rule 2 doesn't match. Rule 3 doesn't match. Rule 4 does match. The engine checks if there are more than 10 dev images. If yes, the oldest ones get deleted. That image never reaches rule 5.

Finally, consider an untagged image. Rules 1-4 all have `"tagStatus": "tagged"`, so they don't match. Rule 5 has `"tagStatus": "untagged"`, so it matches. The engine checks if the image is older than 2 days and deletes it if true.

This priority ordering is why it matters that you put your most specific or most important rules first. You want production images evaluated with their own rules before they could potentially match a catch-all rule.

### Testing Policies Safely with Dry-Run

Before applying a lifecycle policy to a production repository, you absolutely should test what it would do. AWS provides a dry-run feature that shows you which images would be deleted without actually deleting them.

To test a policy, you can use the AWS CLI. First, create a JSON file with your policy:

```bash
# save your policy to a file
cat > lifecycle-policy.json << 'EOF'
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Keep 10 most recent images",
      "selection": {
        "tagStatus": "tagged",
        "countType": "imageCountMoreThan",
        "countNumber": 10
      },
      "action": {
        "type": "expire"
      }
    }
  ]
}
EOF
```

Then run the preview command to see what would happen:

```bash
aws ecr start-lifecycle-policy-preview \
  --repository-name my-app \
  --lifecycle-policy-text file://lifecycle-policy.json \
  --region us-east-1
```

This command initiates a preview and returns a preview ID. You can then check the results:

```bash
aws ecr get-lifecycle-policy-preview-result \
  --repository-name my-app \
  --lifecycle-policy-text file://lifecycle-policy.json \
  --region us-east-1
```

The output shows you which images would be deleted, their tags, and which rule would cause them to be deleted. Review this output carefully. If you see something unexpected—like production images being deleted when they shouldn't be—adjust your policy and run the preview again.

Only after you've verified that the preview shows the behavior you expect should you apply the policy for real:

```bash
aws ecr put-lifecycle-policy \
  --repository-name my-app \
  --lifecycle-policy-text file://lifecycle-policy.json \
  --region us-east-1
```

### Common Pitfalls and How to Avoid Them

One frequent mistake is creating rules with `countType: "imageCountMoreThan"` but forgetting to include `tagPrefixList`. Without a tag filter, the rule applies to all tagged images regardless of prefix. If you then have multiple tag prefixes, the count is shared across all of them, which might not be what you intended. If you want separate counts for different prefixes, you need separate rules.

Another pitfall is using `tagStatus: "any"` without careful thought. This includes both tagged and untagged images in the same count. Usually you want to handle tagged and untagged images separately with different retention strategies.

People sometimes create overlapping rules where an image could theoretically match multiple rules. Remember that priority order determines which rule applies. The first match wins, so structure your rules so that more specific criteria come first. For instance, put `prod-release-` before just `prod-` if both exist.

Also, be aware that the policy doesn't prevent you from deleting images that are currently in use. If an image is currently running in an ECS task or being pulled by a Kubernetes cluster, a lifecycle policy will still delete it if the rules match. The policy runs against the registry, not against running deployments. This is why it's crucial to plan your retention counts carefully, keeping enough images to handle your typical rollback scenarios.

### Monitoring and Adjusting Your Policy

After your policy is in place and running, monitor how many images are being deleted each day and whether your storage costs are decreasing as expected. You can check your ECR repository size in the AWS Console, and you should see it stabilize once the policy has cleaned up accumulated images.

If you find that your retention counts are too aggressive and you're running out of images to roll back to, increase the count numbers in your rules. If your storage is still growing too quickly, decrease the numbers or reduce the time window for untagged images.

Some teams also add a catch-all rule at the end that acts as a safety net, ensuring that even images with unexpected tag formats don't accumulate forever:

```json
{
  "rulePriority": 99,
  "description": "Fallback: keep 5 most recent of any other images",
  "selection": {
    "tagStatus": "any",
    "countType": "imageCountMoreThan",
    "countNumber": 5
  },
  "action": {
    "type": "expire"
  }
}
```

This rule would only apply to images that didn't match any earlier, more specific rules.

### Combining Policies with Tagging Strategy

The effectiveness of lifecycle policies depends heavily on your tagging discipline. If you tag images consistently—`prod-release-1.5.0`, `staging-v1.5.0-rc1`, `dev-build-20240115`—your policies can be precise and maintainable. If tagging is inconsistent, policies become fragile and less effective.

Work with your team to establish clear tagging conventions. Decide what each tag prefix means, who creates which tags, and what the format will be. Document these conventions. Then, your lifecycle policies can confidently identify and manage images based on these predictable patterns.

### Conclusion

ECR lifecycle policies transform image management from a manual, time-consuming chore into an automated process that consistently keeps your registry clean and your storage costs under control. By understanding how rules are evaluated, how priority ordering works, and how to test safely before deploying, you can confidently implement policies that match your team's retention requirements.

Start simple—perhaps with a rule to delete untagged images after a few days—and gradually add complexity as you learn how your team creates and consumes images. Always test with dry-run before applying changes to production repositories. With these practices in place, your ECR repositories will stay lean, your deployments will be reliable, and your AWS bill will thank you.
