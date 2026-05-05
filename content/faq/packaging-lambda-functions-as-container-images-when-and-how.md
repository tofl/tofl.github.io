---
title: "Packaging Lambda Functions as Container Images: When and How"
---

## Packaging Lambda Functions as Container Images: When and How

For years, AWS Lambda developers had one deployment package option: the ZIP file. Drop your code and dependencies into a compressed archive, upload it, and move on. It worked well for most use cases. But what happens when your application has massive dependencies—think machine learning libraries, complex system tools, or a sizable compiled binary—and your ZIP balloons to the 250 MB limit? Or what if you already have a mature Docker workflow and want to leverage it for serverless? That's where Lambda container images come in.

Container images represent a fundamentally different way to package and deploy Lambda functions. Instead of compressing code into a ZIP, you build a Docker image, push it to Amazon Elastic Container Registry (ECR), and tell Lambda to run that image. It opens new possibilities for developers working with heavy dependencies, specialized tooling, or teams already invested in containerization. But it also introduces new considerations around cold starts, build pipelines, and local testing.

This guide walks you through everything you need to know about Lambda container images—how to build them, deploy them, test them locally, and decide whether they're right for your workload.

### Understanding Lambda's Packaging Options

Before diving into container images, it helps to understand the landscape. Lambda supports three deployment package types: ZIP files from S3, ZIP files uploaded directly, and container images from ECR. The ZIP approach is the default and often the best choice. It's simple, fast to deploy, and integrates seamlessly with tools like AWS SAM and the Serverless Framework.

Container images change the game when simplicity no longer serves you. Instead of fighting ZIP limitations, you leverage the full power of Docker and the enormous ecosystem of pre-built container images. You can include system libraries, command-line tools, compiled extensions—anything you'd normally install in a Docker container. The trade-off is complexity. Building, storing, and managing container images requires more infrastructure and introduces additional steps in your deployment pipeline.

The key constraint to understand is the image size limit: container images cannot exceed 10 GB when uncompressed. By contrast, ZIP deployments max out at 250 MB for direct uploads and 500 MB for files stored in S3. This massive increase in allowable size is the primary reason teams choose container images. It's not just about exceeding the limit; it's about the breathing room. A 500 MB dependency bundle that would be impossible in a ZIP becomes trivial in a container image.

### Building a Container Image for Lambda

Lambda container images follow a specific contract: they must implement the Lambda Runtime Interface. This is the mechanism by which Lambda communicates with your function code—sending events, receiving responses, and handling errors. Fortunately, AWS provides official base images that already implement this interface, making your job straightforward.

#### Using AWS-Provided Base Images

AWS maintains base images for all supported runtimes: Python, Node.js, Java, Go, Ruby, and .NET. These images come with the runtime pre-installed and the Runtime Interface already configured. Starting from one of these is the easiest path.

Here's a concrete example: a Python function that processes images using OpenCV, a library with substantial system dependencies. Your Dockerfile might look like this:

```dockerfile
FROM public.ecr.aws/lambda/python:3.11

# Install system dependencies
RUN yum install -y opencv-devel

# Copy your function code
COPY app.py ${LAMBDA_TASK_ROOT}/

# Set the Lambda handler
CMD [ "app.lambda_handler" ]
```

The `FROM` line pulls an AWS-provided base image for Python 3.11 from the public ECR registry. These images are optimized for Lambda and include the Runtime Interface pre-configured. The `${LAMBDA_TASK_ROOT}` variable, set by the base image, points to `/var/task`—Lambda's working directory for your code.

For Node.js, the pattern is similar:

```dockerfile
FROM public.ecr.aws/lambda/nodejs:18

# Copy package files and install dependencies
COPY package*.json ${LAMBDA_TASK_ROOT}/
RUN npm ci

# Copy application code
COPY src/ ${LAMBDA_TASK_ROOT}/

# Set the Lambda handler
CMD [ "index.handler" ]
```

The base images come in two variants: `latest` includes npm and pip for package installation, while the `build` variant includes additional build tools. For production deployments, you typically build in a multi-stage setup: install everything you need in a build stage, then copy artifacts into a minimal runtime stage. This keeps your final image lean.

#### Implementing a Custom Runtime Interface

For languages not officially supported or highly specialized requirements, you can implement the Runtime Interface yourself. This requires understanding the Lambda Runtime API, a simple HTTP-based interface.

Your custom handler must listen on port 9001 and respond to two endpoints: `/2015-03-31/functions/function/invocations` to receive events, and `/2015-08-15/runtime/invocation/{request-id}/response` to return responses. Here's a minimal Go example:

```go
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
)

func handler(event json.RawMessage) (string, error) {
	var input map[string]interface{}
	if err := json.Unmarshal(event, &input); err != nil {
		return "", err
	}
	return fmt.Sprintf("Processed: %v", input), nil
}

func main() {
	eventURL := os.Getenv("AWS_LAMBDA_RUNTIME_API") + "/2015-03-31/functions/function/invocations"
	
	for {
		resp, err := http.Get(eventURL)
		if err != nil {
			continue
		}
		
		var event json.RawMessage
		json.NewDecoder(resp.Body).Decode(&event)
		
		result, _ := handler(event)
		
		http.Post(
			"http://localhost:9001/2015-08-15/runtime/invocation/"+resp.Header.Get("Lambda-Runtime-Request-Id")+"/response",
			"application/json",
			bytes.NewReader([]byte(result)),
		)
		resp.Body.Close()
	}
}
```

In practice, building a custom Runtime Interface is rare. The AWS-provided base images cover nearly all common scenarios. Only consider this approach if you have truly specialized requirements that the base images don't support.

### Building and Pushing Your Image to ECR

Once you have your Dockerfile, building the image is standard Docker. The twist is where you push it: Amazon ECR, a fully managed container registry integrated directly into the AWS ecosystem.

Start by creating an ECR repository to store your images:

```bash
aws ecr create-repository --repository-name my-lambda-function
```

AWS returns details about your new repository, including its URI. You'll need this URI later when configuring your Lambda function.

Before pushing, authenticate your Docker client with ECR. AWS provides a helper command:

```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com
```

Replace the region and account ID with your values. This command logs you in for 12 hours.

Now build and tag your image:

```bash
docker build -t my-lambda-function:latest .
docker tag my-lambda-function:latest 123456789012.dkr.ecr.us-east-1.amazonaws.com/my-lambda-function:latest
```

Push it to ECR:

```bash
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/my-lambda-function:latest
```

ECR charges for storage but the rates are reasonable—roughly $0.10 per GB per month. Compare this to the convenience and size allowance, and for many teams it's a clear win.

### Creating and Configuring a Lambda Function with a Container Image

With your image safely stored in ECR, configuring your Lambda function is straightforward. You can do this through the AWS Console or CLI.

Using the AWS CLI:

```bash
aws lambda create-function \
  --function-name my-function \
  --role arn:aws:iam::123456789012:role/lambda-role \
  --code ImageUri=123456789012.dkr.ecr.us-east-1.amazonaws.com/my-lambda-function:latest \
  --package-type Image \
  --timeout 60 \
  --memory-size 512
```

The `--package-type Image` flag tells Lambda you're using a container image rather than a ZIP. Everything else—memory, timeout, environment variables, VPC configuration—works exactly as it does for ZIP functions.

To update your function after pushing a new image version:

```bash
aws lambda update-function-code \
  --function-name my-function \
  --image-uri 123456789012.dkr.ecr.us-east-1.amazonaws.com/my-lambda-function:v2.0
```

One important detail: Lambda functions always run the image with the `CMD` instruction from your Dockerfile. If your Dockerfile specifies `CMD [ "app.lambda_handler" ]`, Lambda executes that command. This is how Lambda knows which function to invoke. Unlike ZIP deployments where you separately specify a handler in the function configuration, container images bake this in during the build.

### Understanding Cold Starts and Performance Implications

Cold starts are the elephant in the room when discussing Lambda container images. A cold start occurs when Lambda needs to initialize a new execution environment to handle an invocation. This involves pulling the image from ECR, decompressing it, starting the container, and running your initialization code.

For ZIP functions, this process typically takes 100–300 milliseconds. For container images, expect significantly longer. Pulling a 500 MB image from ECR and decompressing it introduces overhead that can stretch cold start times to 1–5 seconds depending on your image size and network conditions. For applications where every millisecond matters—high-frequency trading, real-time streaming—this matters. For batch processing, scheduled tasks, or API endpoints with some tolerance for latency, it's often acceptable.

Minimizing image size is your first line of defense. Use multi-stage builds to avoid shipping unnecessary build tools. Start from slim or minimal base images when available. Prune unused dependencies ruthlessly. Every megabyte counts.

Provisioned concurrency can eliminate cold starts entirely. By keeping execution environments warm at all times, Lambda bypasses initialization entirely. This comes at a cost—you pay per concurrent environment per hour—but for latency-sensitive workloads it's the right trade-off. You configure this in the function's concurrency settings.

Another strategy is to keep your initialization code lightweight. Any code that runs at container startup (outside your handler function) contributes to cold start time. Heavy initialization—loading large models, initializing database connections, building in-memory caches—should happen as lazily as possible, on first invocation rather than container startup.

### Local Testing with the Lambda Runtime Interface Emulator

Developing Lambda functions locally is crucial, and container images introduce a wrinkle: you need to test the actual container, not just your code. AWS provides the Lambda Runtime Interface Emulator (RIE) for exactly this purpose.

The RIE simulates the Lambda execution environment on your local machine. Combined with Docker, it lets you test your function as it would run in production.

First, download the emulator for your architecture:

```bash
mkdir -p ~/.aws-lambda-rie && cd ~/.aws-lambda-rie
curl -Lo lambda-rie https://github.com/aws/aws-lambda-runtime-interface-emulator-releases/releases/latest/download/aws-lambda-rie
chmod +x lambda-rie
```

Then run your container with the emulator:

```bash
docker run -d -v ~/.aws-lambda-rie:/opt/extensions -p 9000:8080 \
  --entrypoint /opt/extensions/aws-lambda-rie \
  my-lambda-function:latest \
  app.lambda_handler
```

Now invoke your function locally:

```bash
curl -X POST "http://localhost:9000/2015-03-31/functions/function/invocations" \
  -d '{"name": "test"}'
```

The RIE responds with your function's output, complete with any errors or logs. This is invaluable for catching issues before deployment.

For more realistic testing, many teams integrate RIE into their container image itself. Your Dockerfile can include logic to detect whether it's running under RIE or in production Lambda:

```dockerfile
FROM public.ecr.aws/lambda/python:3.11

COPY requirements.txt ${LAMBDA_TASK_ROOT}/
RUN pip install -r requirements.txt

COPY src/ ${LAMBDA_TASK_ROOT}/

# Download and configure the Runtime Interface Emulator
RUN curl -o /opt/extensions/aws-lambda-rie https://github.com/aws/aws-lambda-runtime-interface-emulator-releases/releases/latest/download/aws-lambda-rie && \
    chmod +x /opt/extensions/aws-lambda-rie

COPY entrypoint.sh /
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["app.lambda_handler"]
```

Your `entrypoint.sh` script can then check for the RIE environment variable and route accordingly:

```bash
#!/bin/bash
if [ -z "$AWS_LAMBDA_RUNTIME_API" ]; then
    /opt/extensions/aws-lambda-rie /usr/local/bin/python -m awslambdaric "$@"
else
    /usr/local/bin/python -m awslambdaric "$@"
fi
```

This approach keeps your local and production environments nearly identical, reducing surprises when code goes live.

### Container Images vs. ZIP Packages: Making the Choice

Both deployment options are valid. Neither is universally superior. The choice depends on your specific constraints and workflow.

Choose ZIP packages if your dependencies are modest, you're building simple stateless functions, and fast deployment cycles matter. ZIP files upload and deploy quickly because they're small. The AWS Lambda console even lets you edit code inline for quick iteration. Cold start times are minimal. The entire ecosystem of Lambda tools—SAM, Serverless Framework, CDK, CloudFormation—has native ZIP support and excellent tooling.

Choose container images if your dependencies are substantial, you already have Docker-based workflows, or you need to include system-level tools or compiled binaries. Container images scale to enormous sizes, giving you freedom you simply don't have with ZIPs. If you're already building Docker images in your CI/CD pipeline for other services, extending that to Lambda functions adds minimal overhead. Teams familiar with containerization often find the Docker approach more natural than wrestling with ZIP file structures and dependency management.

There's also a middle ground: use container images for functions with heavy dependencies while keeping simple utility functions as ZIPs. Your deployment strategy doesn't have to be monolithic.

Build and deployment complexity favors ZIPs. Pushing a ZIP is nearly instantaneous. Building and pushing a container image, even optimized, takes longer. Your CI/CD pipeline becomes more complex. For rapid iteration during development, this can feel cumbersome.

Performance considerations cut both ways. Container images have slower cold starts but can be more efficient at runtime due to the flexibility of what you can include. If you're deploying a Python function that benefits from a compiled extension unavailable to pure Python Lambda functions, a container image might actually perform better overall despite the cold start penalty.

Cost is subtle. Container images cost money to store in ECR and incur network egress charges when Lambda pulls them. For functions invoked thousands of times daily, these costs accumulate. By contrast, ZIP files are stored in S3, which is cheaper, and Lambda caches them locally. However, if your image is 500 MB and you can't possibly fit it in a ZIP, the comparison is moot.

### Best Practices for Production Container Images

If you commit to container images, follow these practices to keep them reliable and efficient.

First, use semantic versioning for your image tags. Don't rely on `latest`—this tag is ambiguous in production environments. Tag each build with a version number: `my-function:1.2.3`. This makes deployments reproducible and rollbacks straightforward.

Second, scan images for security vulnerabilities. ECR integrates with Amazon Inspector to detect known vulnerabilities in your images and base images. Enable basic image scanning in your ECR repositories and review findings regularly.

Third, minimize image size aggressively. Use multi-stage builds to exclude unnecessary artifacts. Start from slim base images. Understand what each layer adds and whether it's necessary. Use `.dockerignore` to exclude development files from the build context.

Fourth, pin base image versions. Rather than using `public.ecr.aws/lambda/python:3.11`, be specific: `public.ecr.aws/lambda/python:3.11.2024.01.10`. This prevents surprising updates when AWS releases new base images.

Fifth, keep images read-only where possible. Lambda executes functions with a read-only filesystem except for `/tmp`. If your code requires writing files, use `/tmp` and understand that these files are ephemeral—they'll disappear when the execution environment shuts down.

Finally, test images thoroughly with the RIE before deploying to production. Catch environment-specific issues locally rather than discovering them after deployment.

### Deployment Automation and CI/CD Integration

For any serious use of container images, automation is essential. Building and pushing images manually is error-prone and tedious. Integrate image builds into your CI/CD pipeline.

Most teams use services like AWS CodeBuild or GitHub Actions. A basic CodeBuild buildspec file for a Lambda function might look like this:

```yaml
version: 0.2

phases:
  pre_build:
    commands:
      - aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
      - REPOSITORY_URI=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/my-function
      - IMAGE_TAG=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)
  
  build:
    commands:
      - docker build -t $REPOSITORY_URI:latest -t $REPOSITORY_URI:$IMAGE_TAG .
  
  post_build:
    commands:
      - docker push $REPOSITORY_URI:latest
      - docker push $REPOSITORY_URI:$IMAGE_TAG
      - aws lambda update-function-code --function-name my-function --image-uri $REPOSITORY_URI:latest

artifacts:
  files: '**/*'
```

This pipeline automatically builds, tags, and pushes your image on every commit, then updates your Lambda function. Combined with automated testing of your code, this creates a reliable deployment process.

For teams using Terraform or CloudFormation, you can manage the Lambda function definition and its image URI in infrastructure-as-code. This ties function configuration to code, ensuring they stay synchronized.

### Summary and Next Steps

Lambda container images represent a powerful deployment option for functions with substantial dependencies or teams already invested in Docker. They unlock a 10 GB size limit, integrate with existing containerization workflows, and provide flexibility that ZIP packages can't match.

But they come at a cost: more complex builds, slower cold starts, and additional infrastructure for image storage. The decision should be deliberate, based on your specific constraints and priorities.

If you choose container images, start with AWS-provided base images and the Lambda Runtime Interface Emulator for local testing. Invest in CI/CD automation from the beginning. Monitor image sizes and cold start performance. And remember: you don't have to choose one approach for your entire application. Use container images where they make sense and ZIP packages elsewhere.

The flexibility to choose your deployment model is one of Lambda's greatest strengths. Use it wisely.
