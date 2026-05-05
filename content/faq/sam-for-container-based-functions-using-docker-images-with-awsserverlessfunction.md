---
title: "SAM for Container-Based Functions: Using Docker Images with AWS::Serverless::Function"
---

## SAM for Container-Based Functions: Using Docker Images with AWS::Serverless::Function

For years, Lambda developers have relied on ZIP file deployments to package their functions. You zip up your code, upload it, and away you go. But what happens when your function has specialized system dependencies, complex native libraries, or a codebase that's just too large for ZIP's practical limits? What if you want reproducible builds across your entire team without wrestling with Lambda Layers? This is where container-based Lambda functions shine, and AWS SAM makes packaging them remarkably straightforward.

The `ImageUri` property transforms your `AWS::Serverless::Function` into a container-native resource, letting you leverage everything Docker offers while keeping all the benefits of serverless architecture. In this article, we'll explore how to build and deploy Lambda functions as Docker container images using SAM, dig into the performance implications, and walk through practical examples that demonstrate when and why you'd choose this approach.

### Why Container Images for Lambda?

Before we dive into the mechanics, let's establish why container images matter. A ZIP-based Lambda function is constrained by several practical limits. The uncompressed code package can't exceed 250 MB, and if you're using Lambda Layers to share dependencies, you're still managing the complexity of layer versioning and compatibility. Now imagine a machine learning model that's 500 MB, a specialized system library that requires compilation, or a monolithic application that you're migrating to serverless. These scenarios become difficult with traditional ZIP deployment.

Container images solve this elegantly. A Docker image can be significantly larger—up to 10 GB uncompressed—giving you enormous flexibility. You define dependencies, system packages, and build steps in a Dockerfile, which serves as executable documentation for your function's environment. This approach also enables consistency: the image you test locally is the exact image that runs in production, eliminating the "works on my machine" problem.

SAM bridges the gap between your container workflow and Lambda's expectations. Rather than manually building Docker images and pushing them to Amazon ECR, you work with familiar SAM commands that orchestrate the entire process.

### Understanding ImageUri and Container Fundamentals

When you deploy a Lambda function with a ZIP file, you use the `CodeUri` property, which points to your code artifact. With container-based functions, you replace `CodeUri` with `ImageUri`. This property tells SAM where your container image lives, typically in an Amazon ECR repository.

Here's what a minimal SAM template looks like for a container function:

```yaml
AWSTemplateCloudFormation:
  Transform: AWS::Serverless-2016-10-31

Resources:
  MyContainerFunction:
    Type: AWS::Serverless::Function
    Properties:
      PackageType: Image
      ImageUri: 123456789012.dkr.ecr.us-east-1.amazonaws.com/my-function:latest
      MemorySize: 512
      Timeout: 30
```

Notice the `PackageType: Image`. This tells AWS CloudFormation that you're deploying a container image rather than a ZIP archive. Without this property, CloudFormation assumes `PackageType: Zip`.

The `ImageUri` follows the standard Docker registry format: `registry/repository:tag`. In AWS, your registry is your ECR endpoint, the repository is your image name, and the tag identifies the version. SAM can generate this URI for you automatically during the build process, which we'll explore shortly.

### Structuring Your Dockerfile for Lambda

Before SAM builds your image, you need a Dockerfile. Lambda functions run on a specific runtime environment, and your Dockerfile must align with Lambda's expectations. The good news is that AWS publishes official base images for each Lambda runtime, removing much of the guesswork.

Consider a Python function with numpy and pandas dependencies:

```dockerfile
FROM public.ecr.aws/lambda/python:3.11

# Copy requirements into the container
COPY requirements.txt ${LAMBDA_TASK_ROOT}

# Install dependencies
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

# Copy function code
COPY app.py ${LAMBDA_TASK_ROOT}

# Set the CMD to your handler
CMD ["app.lambda_handler"]
```

Let's break this down. The base image `public.ecr.aws/lambda/python:3.11` is provided by AWS and includes Python 3.11 pre-configured for Lambda execution. The `LAMBDA_TASK_ROOT` environment variable is set by this base image and points to `/var/task`, which is Lambda's working directory.

The order of your Dockerfile instructions matters for performance. Docker builds images in layers, and each layer is cached. If you copy your entire codebase before installing dependencies, any code change forces dependency reinstallation—an expensive operation. Instead, copy `requirements.txt` first, install dependencies, then copy your code. This way, code-only changes skip the dependency layer.

After installing dependencies, you copy your application code, and finally set the `CMD` instruction. This tells Lambda which function to invoke when your Lambda executes. The format is `["file.function_name"]` for Python, `["index.handler"]` for Node.js, or the appropriate handler syntax for your runtime.

### Building and Pushing with SAM

This is where the magic happens. Rather than manually building Docker images and pushing them to ECR, SAM automates the workflow. When you run `sam build`, SAM detects that your function uses `PackageType: Image`, builds the Docker image locally using your Dockerfile, and prepares it for deployment. When you run `sam deploy`, SAM pushes the image to ECR and updates your Lambda function.

Let's walk through the process with a practical example. Assume you have a SAM template, a Dockerfile, and your application code in a directory structure like this:

```
my-lambda-project/
├── template.yaml
├── src/
│   ├── Dockerfile
│   └── app.py
└── requirements.txt
```

Your template references the image:

```yaml
AWSTemplateCloudFormation:
  Transform: AWS::Serverless-2016-10-31

Resources:
  DataProcessorFunction:
    Type: AWS::Serverless::Function
    Properties:
      PackageType: Image
      ImageUri: !Sub "${AWS::AccountId}.dkr.ecr.${AWS::Region}.amazonaws.com/data-processor:latest"
      MemorySize: 1024
      Timeout: 120
      Policies:
        - S3CrudPolicy:
            BucketName: my-data-bucket
```

Notice the `ImageUri` uses CloudFormation intrinsic functions to construct the ECR URL dynamically. This is cleaner than hardcoding your account ID.

Now, when you run `sam build`, SAM performs these steps:

1. Reads your template and identifies that your function has `PackageType: Image`
2. Builds the Docker image using the Dockerfile in the `src` directory
3. Tags the image with a SAM-generated name based on your template and function logical ID

The build output appears in a `.aws-sam/build` directory, and SAM generates a new template with updated image references.

To push the image to ECR and deploy your function, you run `sam deploy --guided` (for initial setup) or simply `sam deploy` for subsequent deployments. SAM handles several things for you automatically:

- It creates an ECR repository if one doesn't exist
- It authenticates to ECR using your AWS credentials
- It pushes the built image to the repository
- It updates your CloudFormation stack with the new image URI
- It provisions or updates your Lambda function

Here's what this looks like in practice:

```bash
# Build the image
sam build

# Deploy (with guided setup on first run)
sam deploy --guided

# For subsequent deployments
sam deploy
```

If you want more control over the image URI, you can explicitly specify it during deployment:

```bash
sam deploy \
  --image-repository 123456789012.dkr.ecr.us-east-1.amazonaws.com/my-functions \
  --resolve-image-repos
```

The `--resolve-image-repos` flag tells SAM to use the repository you specified for all container images in your template.

### Optimizing Container Images for Lambda Cold Starts

Container images introduce a consideration that ZIP-based functions don't face as prominently: cold start performance. When Lambda creates a new execution environment, it must pull and extract your image layers before your function code executes. Larger images mean longer cold starts.

A cold start with a container image involves these steps: pulling layers from ECR, extracting them into the execution environment, and finally invoking your handler. For frequently invoked functions in production, this might be negligible because you have provisioned concurrency. But for unpredictable workloads, image size directly impacts latency.

Optimize your Dockerfile with several strategies in mind. First, use multi-stage builds to avoid shipping build artifacts with your final image:

```dockerfile
# Build stage
FROM public.ecr.aws/lambda/python:3.11 as builder

COPY requirements.txt /tmp/
RUN pip install --target "${LAMBDA_TASK_ROOT}" -r /tmp/requirements.txt

# Final stage
FROM public.ecr.aws/lambda/python:3.11

# Copy only the installed packages from builder, not the entire /tmp directory
COPY --from=builder ${LAMBDA_TASK_ROOT} ${LAMBDA_TASK_ROOT}
COPY app.py ${LAMBDA_TASK_ROOT}

CMD ["app.lambda_handler"]
```

Multi-stage builds eliminate intermediate layers that contain build tools, temporary files, and dependencies that didn't make it into the final image.

Second, be deliberate about which dependencies you include. Use `pip install --no-cache-dir` to skip caching package metadata, which reduces image size. For Python, consider using lightweight alternatives to heavy libraries where feasible. Instead of the entire pandas library for simple data manipulation, you might use csv or json libraries built into Python.

Third, understand that Docker layer caching is your friend during local development but works against you in production. If a layer changes, all subsequent layers must be rebuilt. Structure your Dockerfile so that frequently changing code (your application logic) is in later layers, while stable dependencies are in earlier layers.

Fourth, compress your final image. Docker supports image compression, and ECR stores images efficiently, but smaller is always better for pull times. Use `.dockerignore` to exclude unnecessary files:

```
*.pyc
__pycache__
.pytest_cache
.git
.gitignore
node_modules
*.env
```

For a realistic comparison, a simple Python function with minimal dependencies might result in an image under 100 MB, adding perhaps 500 milliseconds to a cold start. A machine learning function with TensorFlow might be 2-3 GB, potentially adding several seconds. These trade-offs are worth it when your function has complex requirements that couldn't otherwise fit in a ZIP.

### Container vs. ZIP: Making the Choice

Both packaging models have merits, and your choice depends on your specific requirements. ZIP files are simpler, faster to deploy, and incur negligible cold start overhead. They're ideal for straightforward functions with minimal dependencies, quick iteration cycles, and functions that need to be as responsive as possible.

Container images excel when you have specialized requirements. If your function needs system libraries (like `libpq` for PostgreSQL client functionality), custom native extensions, or dependencies exceeding a few hundred megabytes, containers are the clear choice. They're also better when you want identical local and production environments for testing.

Consider a practical scenario: a function that resizes images using ImageMagick. ImageMagick requires system-level installation and brings significant dependencies. With a ZIP file, you'd need to compile ImageMagick for the Amazon Linux environment (which Lambda uses), include those binaries in your package, and hope the compilation is compatible. With a container, you simply install ImageMagick in your Dockerfile and test the image locally.

Another scenario: migrating a existing application to Lambda. If you have a Flask application with dozens of dependencies, containerizing it lets you reuse your existing Docker setup rather than repackaging everything for Lambda's ZIP constraints.

### Handling Image Updates and Versioning

As your function evolves, managing image versions becomes important. You could use mutable tags like `latest`, but this creates unpredictability—different deployments might run different code. Instead, use immutable tags with semantic versioning:

```yaml
ImageUri: !Sub "${AWS::AccountId}.dkr.ecr.${AWS::Region}.amazonaws.com/my-function:1.2.3"
```

When you update your function, increment the version, rebuild, push, and update your template. This ensures every deployment is reproducible and easily rolled back.

SAM can automate this. If you use SAM's metadata directives and CI/CD pipelines, you can generate version tags automatically based on your commit SHA or build number. Here's an example with a metadata directive:

```yaml
Resources:
  DataProcessorFunction:
    Type: AWS::Serverless::Function
    Metadata:
      DockerTag: !Sub "${GitCommitSha}"
    Properties:
      PackageType: Image
      ImageUri: !Sub "${AWS::AccountId}.dkr.ecr.${AWS::Region}.amazonaws.com/data-processor:${DockerTag}"
```

This approach requires integration with your CI/CD pipeline, but it's powerful once set up.

### Practical Example: A Complete Container Function

Let's bring everything together with a complete, realistic example. Suppose you're building a function that processes CSV files stored in S3 using pandas, a heavy library that makes ZIP deployment impractical.

Your project structure:

```
csv-processor/
├── template.yaml
├── src/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── processor.py
└── events/
    └── s3_event.json
```

The Dockerfile:

```dockerfile
FROM public.ecr.aws/lambda/python:3.11

COPY requirements.txt ${LAMBDA_TASK_ROOT}
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

COPY processor.py ${LAMBDA_TASK_ROOT}

CMD ["processor.lambda_handler"]
```

The requirements file:

```
pandas==2.0.3
boto3==1.28.0
```

The application code:

```python
import json
import boto3
import pandas as pd
from io import BytesIO

s3_client = boto3.client('s3')

def lambda_handler(event, context):
    """
    Process a CSV file from S3 and return summary statistics.
    """
    bucket = event['Records'][0]['s3']['bucket']['name']
    key = event['Records'][0]['s3']['object']['key']
    
    # Download the CSV file
    response = s3_client.get_object(Bucket=bucket, Key=key)
    csv_content = response['Body'].read()
    
    # Parse with pandas
    df = pd.read_csv(BytesIO(csv_content))
    
    # Generate summary
    summary = {
        'row_count': len(df),
        'column_count': len(df.columns),
        'columns': df.columns.tolist(),
        'numeric_stats': df.describe().to_dict()
    }
    
    return {
        'statusCode': 200,
        'body': json.dumps(summary)
    }
```

The SAM template:

```yaml
AWSTemplateCloudFormation:
  Transform: AWS::Serverless-2016-10-31
  Description: CSV processor function using container image

Globals:
  Function:
    Timeout: 60
    MemorySize: 512

Resources:
  CSVProcessorFunction:
    Type: AWS::Serverless::Function
    Properties:
      PackageType: Image
      ImageUri: !Sub "${AWS::AccountId}.dkr.ecr.${AWS::Region}.amazonaws.com/csv-processor:latest"
      Architectures:
        - x86_64
      Policies:
        - S3CrudPolicy:
            BucketName: !Ref DataBucket
      Events:
        S3Upload:
          Type: S3
          Properties:
            Bucket: !Ref DataBucket
            Events: s3:ObjectCreated:*

  DataBucket:
    Type: AWS::S3::Bucket
    Properties:
      VersioningConfiguration:
        Status: Enabled

Outputs:
  BucketName:
    Description: Name of the data bucket
    Value: !Ref DataBucket
```

To deploy this function:

```bash
sam build
sam deploy --guided
```

SAM builds the image, pushes it to ECR, and creates the CloudFormation stack with your function and S3 bucket.

### Advanced: Working with Private Dependencies

If your dependencies live in private repositories—perhaps an internal Python package index or a private GitHub repository—you'll need to handle authentication during the Docker build.

For a private PyPI index, you can pass credentials as build arguments:

```dockerfile
FROM public.ecr.aws/lambda/python:3.11

ARG PIP_INDEX_URL
ARG PIP_EXTRA_INDEX_URL

COPY requirements.txt ${LAMBDA_TASK_ROOT}
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

COPY app.py ${LAMBDA_TASK_ROOT}

CMD ["app.lambda_handler"]
```

Then build with:

```bash
docker build \
  --build-arg PIP_INDEX_URL=https://user:password@private.index.com/simple \
  -t my-function:latest \
  .
```

For SAM, you can pass build arguments through the template or environment variables. This gets complex quickly, so for production scenarios with private dependencies, consider using Lambda Layers for those dependencies alongside container images, or maintain a private ECR repository with pre-built images.

### Debugging and Local Testing

SAM provides local invocation for container-based functions, letting you test before deployment:

```bash
sam local invoke CSVProcessorFunction -e events/s3_event.json
```

SAM starts a Docker container locally that mimics the Lambda execution environment and invokes your function with the event you provide. This is invaluable for debugging—you get the same runtime behavior locally as you'll see in production.

You can also run a local API Gateway:

```bash
sam local start-api
```

This is less common for asynchronous functions triggered by S3 or other services, but if your function is triggered by HTTP requests through API Gateway, this command spins up a local server that mimics the API Gateway behavior.

### Conclusion

Container-based Lambda functions represent a powerful evolution in serverless development. By using the `ImageUri` property with `PackageType: Image`, you gain access to the full ecosystem of Docker while maintaining the simplicity and cost-effectiveness of serverless architecture. SAM makes this workflow seamless, automating image building, ECR management, and deployment.

Choose container images when traditional ZIP packaging becomes constraining: when you have specialized system dependencies, large codebases, or the need for reproducible environments. Design your Dockerfiles with performance in mind, leveraging multi-stage builds and thoughtful layer ordering to minimize cold starts. Use semantic versioning for your images and integrate SAM deployments into your CI/CD pipeline for consistency.

As you continue building serverless applications, remember that tooling like SAM exists to eliminate friction. What once required manual Docker commands and ECR setup is now a simple `sam build && sam deploy` away. This frees you to focus on what matters: building great applications that scale seamlessly.
