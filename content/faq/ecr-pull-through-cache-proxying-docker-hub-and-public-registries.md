---
title: "ECR Pull Through Cache: Proxying Docker Hub and Public Registries"
---

## ECR Pull Through Cache: Proxying Docker Hub and Public Registries

Anyone who's deployed containers at scale has felt the sting of Docker Hub rate limits. You're rolling out a new service, Kubernetes is spinning up pods, and suddenly your pulls start failing with 429 errors. Or you're in an environment with strict egress controls, and pulling from the public internet feels like working with one hand tied behind your back. This is where Amazon Elastic Container Registry's pull through cache feature becomes invaluable—it acts as a transparent proxy that sits between your deployments and upstream registries, caching images locally while respecting rate limits and reducing your external dependencies.

Let's explore how this feature works, why it matters, and how to implement it effectively.

### Understanding the Problem: Rate Limits and External Dependencies

Before diving into the solution, it's worth understanding the challenge. Docker Hub, the de facto repository for public container images, enforces rate limits on image pulls. Anonymous users get 100 pulls per six hours, while authenticated users get 200 pulls per six hours. For a busy Kubernetes cluster or CI/CD pipeline, these limits disappear faster than you'd expect.

Beyond rate limits, pulling images from public registries introduces operational friction. Every pull incurs network latency, requires external connectivity, and creates a dependency on a third-party service's availability. If Docker Hub experiences an outage, your deployments suffer. If your network egress is metered, you're paying for every byte pulled from the internet.

Additionally, in regulated environments or air-gapped deployments, pulling from the public internet might violate compliance requirements or simply not be possible. You need images to flow through controlled channels.

### What Is ECR Pull Through Cache?

ECR's pull through cache is a feature that turns your private ECR repository into a transparent proxy for upstream registries. When you request an image that doesn't exist in your ECR, the cache automatically pulls it from an upstream source, stores it in your registry, and serves it to you. Subsequent requests for that same image hit your local cache, bypassing the upstream registry entirely.

The elegance of this approach lies in its transparency. Your container orchestration tools, CI/CD systems, and developers don't need to change how they reference images. They point to your ECR repository, and the pull through cache handles the rest behind the scenes.

Currently, ECR pull through cache supports several upstream sources: Docker Hub, Quay.io, GitHub Container Registry, and Amazon ECR Public. This covers the vast majority of publicly available container images.

### How It Solves Real Problems

The pull through cache addresses multiple pain points simultaneously. First, it eliminates rate limiting concerns for most practical purposes. Instead of your entire organization hammering Docker Hub's rate limit bucket, only your first pull of a given image consumes a quota against the upstream source. Everything thereafter comes from your local cache.

Second, it dramatically reduces latency for image pulls after the initial cache population. Pulling from a registry in the same AWS region is orders of magnitude faster than pulling from the public internet, especially for large base images like Ubuntu or Node.js. This translates directly to faster pod startup times in Kubernetes.

Third, it decouples your deployments from upstream registry availability. If Docker Hub goes down, your cached images continue working. You're not entirely immune—you need the cache populated first—but your operational resilience improves substantially.

Fourth, for organizations with egress controls or air-gapped environments, a pull through cache can serve as a sanctioned gateway for container images. You configure which upstream sources are allowed, and everything flows through your approval process.

### Setting Up Pull Through Cache Rules

Configuring pull through cache involves creating rules that map upstream registries to your ECR namespace. Each rule specifies the upstream source and determines how images are named when they land in your registry.

Let's walk through the setup process. You start by creating a pull through cache rule using the AWS Management Console, AWS CLI, or infrastructure-as-code tools like CloudFormation or Terraform.

Here's how you'd create a rule using the AWS CLI to cache images from Docker Hub:

```bash
aws ecr create-pull-through-cache-rule \
    --ecr-repository-prefix docker-hub \
    --upstream-registry-url docker.io \
    --region us-east-1
```

This rule tells ECR: "When someone requests an image from the `docker-hub` namespace in my ECR that doesn't exist locally, go fetch it from Docker Hub and cache it here." If you later pull `my-registry.dkr.ecr.us-east-1.amazonaws.com/docker-hub/library/ubuntu:latest`, ECR will fetch `docker.io/library/ubuntu:latest`, cache it, and serve it to you.

You can create multiple rules targeting different upstream sources. For example:

```bash
aws ecr create-pull-through-cache-rule \
    --ecr-repository-prefix quay \
    --upstream-registry-url quay.io \
    --region us-east-1

aws ecr create-pull-through-cache-rule \
    --ecr-repository-prefix ghcr \
    --upstream-registry-url ghcr.io \
    --region us-east-1
```

Now your developers can reference images as:
- `my-registry.dkr.ecr.us-east-1.amazonaws.com/docker-hub/library/ubuntu:latest` (from Docker Hub)
- `my-registry.dkr.ecr.us-east-1.amazonaws.com/quay/redhat/ubi8:latest` (from Quay.io)
- `my-registry.dkr.ecr.us-east-1.amazonaws.com/ghcr/myorg/myimage:latest` (from GitHub Container Registry)

The namespace prefix becomes part of your image reference, making it explicit where each image originated.

### Authentication and Credentials

Here's where things get interesting: authentication. Docker Hub and other public registries may require credentials, especially if you're making heavy use of their service or accessing private repositories.

For Docker Hub, you'd create a secret in AWS Secrets Manager containing your Docker Hub credentials. Then, when creating the pull through cache rule, you reference that secret. ECR uses these credentials when pulling from Docker Hub, allowing you to benefit from higher rate limits (authenticated pulls get more quota than anonymous ones).

The process looks like this: First, create a secret in Secrets Manager:

```bash
aws secretsmanager create-secret \
    --name dockerhub-credentials \
    --secret-string '{"username":"your-username","password":"your-token"}' \
    --region us-east-1
```

Then, when creating your pull through cache rule, reference the secret:

```bash
aws ecr create-pull-through-cache-rule \
    --ecr-repository-prefix docker-hub \
    --upstream-registry-url docker.io \
    --credential-arn arn:aws:secretsmanager:us-east-1:123456789012:secret:dockerhub-credentials \
    --region us-east-1
```

This approach keeps credentials out of your code and configuration files, leveraging AWS's secrets management infrastructure instead.

### Managing Image Lifecycle and Storage

Pull through cache doesn't automatically clean up cached images. Over time, your ECR repository can accumulate many cached images, consuming storage and potentially driving up costs. You'll want to implement lifecycle policies to manage this.

ECR lifecycle policies let you automatically delete images based on age, count, or tag patterns. A common pattern is to keep only recently used cached images, automatically pruning images that haven't been pulled in, say, 90 days.

You could create a lifecycle policy like this using the AWS CLI:

```bash
aws ecr put-lifecycle-policy \
    --repository-name docker-hub \
    --lifecycle-policy-text '{
        "rules": [
            {
                "rulePriority": 1,
                "description": "Remove cached images older than 90 days",
                "selection": {
                    "tagStatus": "any",
                    "countType": "sinceImagePushed",
                    "countUnit": "days",
                    "countNumber": 90
                },
                "action": {
                    "type": "expire"
                }
            }
        ]
    }' \
    --region us-east-1
```

This policy automatically removes any images that haven't been pushed (or in the case of pulled-through images, accessed) in the last 90 days. You can adjust the threshold based on your usage patterns and storage budget.

### Understanding the Pricing Model

Pricing for ECR pull through cache involves two components: storage and data transfer. Storage costs are straightforward—you pay for the capacity consumed by cached images in your ECR repository, just like any other ECR storage.

Data transfer costs are more nuanced. When ECR pulls an image from an upstream registry, it incurs data transfer charges for the outbound traffic from that upstream source. However, you only incur this cost on the initial pull. Subsequent pulls from your local cache involve no data transfer charges for the upstream pull (though intra-region ECR pulls are free, and inter-region pulls within AWS cost money depending on your data transfer pricing).

The economics work out favorably for most organizations. Consider a scenario where 50 services, each running 20 replicas, need a common base image like Ubuntu (roughly 100 MB). Without pull through cache, that's 1000 pulls × 100 MB = 100 GB of outbound data transfer from Docker Hub. With pull through cache, you pay for one 100 MB pull from Docker Hub, then serve 999 pulls from your local ECR at no additional data transfer cost (assuming same-region access).

For organizations with high image pull volume, the savings compound quickly, often paying for the cache feature many times over.

### Practical Implementation Considerations

When implementing pull through cache, a few design decisions merit careful thought. First, decide on your namespace convention. The prefix you choose becomes part of your image references, so pick something clear and consistent. Many organizations use the upstream registry name (docker-hub, quay, ghcr) while others use descriptive prefixes like public-images or external-images.

Second, consider whether you want to cache all upstream registries or restrict access to approved sources. You might create pull through cache rules only for Docker Hub and your organization's registry on GitHub Container Registry, while explicitly preventing access to other registries. This maintains better control over what dependencies enter your environment.

Third, think about image signing and validation. Pull through cache can work with ECR image scanning and signing features to automatically scan cached images for vulnerabilities and ensure they meet your compliance requirements. This adds another layer of confidence in cached images.

Fourth, test your implementation in a non-production environment first. Ensure your image references work correctly, your upstream credentials function properly, and your lifecycle policies actually clean up images as expected. Pull through cache is generally straightforward, but validation in a low-stakes environment prevents surprises in production.

### Real-World Example: A Kubernetes Deployment

Let's tie this together with a concrete example. Imagine you're running a Kubernetes cluster and using pull through cache for Docker Hub and Quay.io. Your nodes need to pull various images.

You've configured two pull through cache rules:
- `docker-hub` pointing to Docker Hub
- `quay` pointing to Quay.io

In your Kubernetes deployment manifests, instead of referencing images directly from public registries:

```yaml
containers:
- name: app
  image: library/ubuntu:22.04
- name: monitoring
  image: quay.io/prometheus/prometheus:latest
```

You reference them through your ECR pull through cache:

```yaml
containers:
- name: app
  image: 123456789012.dkr.ecr.us-east-1.amazonaws.com/docker-hub/library/ubuntu:22.04
- name: monitoring
  image: 123456789012.dkr.ecr.us-east-1.amazonaws.com/quay/prometheus/prometheus:latest
```

The first time your cluster needs these images, ECR pulls them from the upstream sources, caches them, and serves them to your nodes. Kubelet gets the images, launches the containers. The next time a node needs one of these images—whether that's during an autoscaling event, pod rescheduling, or a new deployment—it pulls from the local cache. Faster, cheaper, and more reliable.

### Limitations and Edge Cases

Pull through cache isn't a complete replacement for every registry strategy. Private images from upstream registries require valid credentials, which adds operational overhead. If you need to cache from GitHub Container Registry, you'll need valid GitHub credentials in your secret.

Additionally, pull through cache works best for relatively static, well-known images. If you're constantly pulling brand-new, unique images from upstream sources (perhaps auto-generated by a CI/CD system), the caching benefits diminish. The feature shines when you're pulling the same set of base images repeatedly.

Image references change when you use pull through cache, which requires coordinating with your team and updating deployment configurations. This is a minor friction point but worth acknowledging during migration planning.

Finally, pull through cache is an AWS regional service. If you operate across multiple AWS regions, you'd need to create separate pull through cache rules in each region, and each region maintains its own cache. This is actually fine for resilience but means you can't share a cache across regions without additional orchestration.

### Moving Forward

ECR pull through cache is a straightforward but powerful feature that solves real operational problems around image availability, rate limiting, and egress control. It requires minimal configuration, integrates transparently with your existing container tooling, and delivers tangible benefits for most organizations using public container images.

The key to successful implementation is thoughtful planning around your image references, lifecycle policies to manage storage, and validation in non-production environments. Once configured, the feature largely works invisibly, sitting between your deployments and the public internet, quietly improving your reliability and reducing your costs.

For teams already invested in AWS and using container technology, pull through cache is worth exploring—it's a relatively low-effort feature that delivers outsized operational benefits.
