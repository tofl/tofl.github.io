---
title: "Elastic Beanstalk Custom Platforms vs Docker: When to Build Your Own Platform"
---

## Elastic Beanstalk Custom Platforms vs Docker: When to Build Your Own Platform

When you're deploying applications to AWS Elastic Beanstalk, you typically have two straightforward options: use one of AWS's managed platforms (like Node.js, Python, or Java) or containerize your application with Docker and let Beanstalk orchestrate it. These paths work beautifully for most teams. But what happens when your application needs specialized system libraries that Docker doesn't easily provide, or when your runtime requires modifications at the OS level that go beyond what managed platforms allow? That's where custom platforms enter the picture—and why understanding them matters for developers who work at the edges of what conventional deployment options can handle.

Custom platforms in Elastic Beanstalk give you the ability to build and version your own platform image, complete with custom OS packages, runtime configurations, and dependencies. This feature exists in the space between the simplicity of managed platforms and the full control of EC2. It's powerful, but it's also a tool you need to wield deliberately. This article walks you through that decision: what custom platforms actually are, when they're the right choice versus Docker, and how to build one when the time comes.

### Understanding the Three Deployment Paths

To appreciate custom platforms, it helps to understand where they sit relative to other Elastic Beanstalk deployment options. Let's think of them as a spectrum of control versus simplicity.

Managed platforms represent the simplest end of that spectrum. AWS maintains these platform versions—Node.js, Python, Go, Java, PHP, .NET, Ruby, and others—with regular updates for security patches, runtime improvements, and compatibility fixes. When you deploy to a managed platform, you're getting a well-tested, hardened environment where Beanstalk handles OS-level configuration, security group setup, and platform updates. You just focus on your application code. The trade-off is that you're constrained to what AWS includes in that platform version. If you need a system library that isn't there, or if your application requires a custom modification to the runtime itself, managed platforms can't easily accommodate that without workarounds.

Docker represents the opposite end. By packaging your application in a Docker container and pointing Beanstalk to the image, you get nearly complete control over the environment. You define every library, every configuration, every detail. Docker is ideal when your needs are genuinely unique or when you're already committed to containerization across your infrastructure. The operational cost, however, is that you're now responsible for maintaining that image—security updates, dependency management, and version control all fall on your shoulders.

Custom platforms occupy the middle ground. They let you start with a foundation similar to a managed platform (the same or very similar OS, the same package manager, similar initialization) and then layer on your specific requirements. AWS provides a Packer-based workflow to build these platforms, version them in Beanstalk, and deploy them to your environments. You get more control than managed platforms but not as much operational burden as Docker.

### When Managed Platforms Fall Short

Before deciding to build a custom platform, you should exhaust what managed platforms can do. They're more capable than developers sometimes realize.

Suppose your Python application needs the `libpq-dev` package for PostgreSQL development headers. You could install this during the application deployment phase using a `.ebextensions` configuration file. Similarly, if you need a specific system tool or utility, you can often install it via package manager commands embedded in your deployment hooks. This approach works fine for one or two small system dependencies.

But consider a more complex scenario: your application uses a specialized geospatial library that requires GDAL (Geospatial Data Abstraction Library) and PROJ, which in turn need specific versions of several OS-level libraries, and those libraries need certain compiler flags to work correctly with your application. Installing these during every deployment is inefficient, fragile, and slows down your deployment pipeline. Each time an instance boots, it's rebuilding this environment from scratch.

Or imagine you're running a research application that requires a custom-compiled version of Python itself—not because of a bug, but because you need specific optimizations or because you're using a fork that includes experimental features your team has contributed. Managed Python platforms can't provide this. You could install your custom Python via a deployment hook, but you'd need to handle updating the system path, configuring virtual environments correctly, and ensuring the custom runtime is available during every deployment. This becomes a maintenance burden.

There are also scenarios involving licensing or security policies. Maybe your organization requires that certain system libraries be compiled from source with specific flags, or that you use a particular version of OpenSSL that has been audited by your security team. A custom platform lets you bake these requirements into the image itself, rather than cobbling them together during each deployment.

### When Docker Is the Cleaner Choice

If you're considering a custom platform, pause and ask: would Docker simply be cleaner?

Docker shines when your requirements are truly idiosyncratic or when you're using a language or framework that Elastic Beanstalk doesn't have a managed platform for. If you're deploying a Rust application, or a specialized analytics tool written in R, or anything else outside AWS's managed platform roster, Docker is the straightforward answer.

Docker also wins when you're already investing in containerization across your organization. If your CI/CD pipeline already builds and pushes Docker images, if you're using container registries, if other teams are working with Docker, the operational familiarity and consistency of staying with Docker often outweigh the appeal of a custom platform.

Additionally, Docker images can be run anywhere—not just on Elastic Beanstalk, but also on ECS, EKS, on-premises, or in another cloud. Custom platforms are tightly coupled to Elastic Beanstalk. If portability matters to you, Docker is the better investment.

The trade-off is that Docker images require you to maintain the full stack: the base OS, all system packages, the runtime, application dependencies, everything. It's more to version, test, and keep secure. For many organizations, this is worthwhile. For others, it's overhead that custom platforms avoid.

### The Case for Custom Platforms

Custom platforms justify themselves in specific situations. The clearest one is when you're working within a language that Elastic Beanstalk supports, you want to leverage the managed platform's integration with Beanstalk (health monitoring, deployment hooks, environment scaling), but you need to add a layer of OS-level customization on top.

Here's a practical example: a team runs a Node.js application that uses native modules compiled against system libraries. The managed Node.js platform doesn't include `libffi-dev`, which is needed to build one of the required native modules. Rather than installing it during every deployment or switching to Docker, they build a custom platform based on the Node.js Amazon Linux 2 foundation, add `libffi-dev`, and deploy using that custom platform. Every instance that launches already has the library, so deployments are faster and the environment is more predictable.

Another example: a Ruby on Rails application integrates with ImageMagick for image processing. The managed Ruby platform includes ImageMagick, but only a certain version, and your application's Gemfile specifies a native gem that requires a newer version of ImageMagick and several of its dependencies. Rather than fighting version compatibility, you create a custom platform that installs the specific ImageMagick version your application needs.

Or consider a data processing application that runs on a Python managed platform but needs R (the statistical language) installed alongside Python so it can spawn R processes for certain computations. This is a legitimate architectural choice, and while you could install R via a deployment hook, doing it once in a custom platform and versioning it is cleaner.

The operational benefit of custom platforms becomes clear when you're running multiple Elastic Beanstalk environments across a team or organization. You build the custom platform once, version it, and reuse it across dozens of environments. Everyone benefits from the same tested, stable platform image. Updates to system dependencies happen in a controlled way: you rebuild the platform image, test it, and then environments can adopt the new version on their own schedule.

### The Packer Workflow: Building Custom Platforms

AWS uses Packer to build custom platforms. Packer is a tool by HashiCorp that automates the creation of machine images. For Elastic Beanstalk, it's the official, supported way to create custom platforms.

The workflow starts with a Packer template, which is a JSON or HCL2 file that describes how to build your image. You specify a base image (AWS provides publicly available base images for each platform language), run provisioning scripts to customize the image, and then Packer creates an Amazon Machine Image (AMI) that Elastic Beanstalk recognizes as a platform.

Let's walk through a concrete example. Imagine you need a Node.js platform that includes `build-essential` (for compiling native modules) and `redis-cli` (for administrative access to Redis databases). You'd start with a directory structure like this:

```
my-custom-platform/
├── builder/
│   ├── platform.yaml
│   └── scripts/
│       └── setup.sh
└── README.md
```

The `platform.yaml` file is the key configuration. Here's what it might look like:

```yaml
---
version: 1.0

builder:
  instance_type: m5.large
  source_ami: ami-0c55b159cbfafe1f0
  
variables:
  PLATFORM: nodejs
  PLATFORMVERSION: "16.13.0"

commands:
  01_create_platform_json:
    command: cat > /opt/elasticbeanstalk/.platform/platform.json << 'EOF'
{
  "name": "Node.js Custom Platform",
  "description": "Custom Node.js with Redis CLI",
  "version": "1.0.0"
}
EOF

  02_install_redis_cli:
    command: "bash /tmp/setup.sh"
```

The setup script (`scripts/setup.sh`) would contain the actual provisioning commands:

```bash
#!/bin/bash
set -e

# Update package manager
yum update -y

# Install build tools
yum install -y build-essential

# Install Redis CLI
yum install -y redis

echo "Platform setup complete"
```

You'd then use the `eb platform create` command to build the platform:

```bash
eb platform create \
  --version my-nodejs-custom-1.0 \
  --builder-config platform.yaml \
  --instance-profile aws-elasticbeanstalk-ec2-role
```

Elastic Beanstalk takes your configuration, launches a temporary EC2 instance, runs your provisioning scripts, and then captures the result as a platform image. This image is stored in your AWS account and can be deployed to any Elastic Beanstalk environment.

### Platform Versioning and Sharing

One of the underappreciated strengths of custom platforms is their versioning model. Every custom platform you create has a version number. You can list all available versions of your platform:

```bash
eb platform list
```

This shows something like:

```
Custom Platforms:
  my-nodejs-custom/1.0.0
  my-nodejs-custom/1.1.0
  my-nodejs-custom/1.2.0
  ...
```

Each version is an independent AMI in your AWS account. This means you can have multiple versions of your custom platform coexisting, and different Elastic Beanstalk environments can use different versions. One environment might use version 1.1.0 while another uses version 1.2.0. This is crucial for managing updates carefully—you can test a new platform version in a development environment before rolling it out to production.

Updating your custom platform is a deliberate process. You don't accidentally pick up a new version; environments explicitly specify which platform version to use. When you're ready to update, you create a new version of your platform, test it thoroughly, and then update your environment configuration to point to the new version. Elastic Beanstalk handles the rest: instances launch with the new platform.

If your organization has multiple teams or multiple applications with similar needs, custom platforms become even more valuable. Your DevOps or platform team can build a standard custom platform that includes libraries and tools everyone needs, version it, and make it available to application teams. Those teams deploy using that shared platform, ensuring consistency across the organization while still allowing each team to own their application code and configuration.

However, sharing custom platforms across AWS accounts requires some care. Custom platforms are stored as AMIs in a specific AWS account. To share a custom platform with another account, you'd need to copy the AMI or use AWS's AMI sharing feature. This adds a small amount of operational overhead, which is worth considering if your custom platform strategy spans multiple accounts.

### Building a Real-World Example: Python with GDAL

Let's work through a more complex real-world example to solidify how this works in practice.

Suppose your team runs a geospatial analysis application in Python that uses the GeoPandas library, which depends on GDAL. The managed Python platform on Amazon Linux 2 includes GDAL, but only version 2.x. Your application requires GDAL 3.x to support a particular map projection format. Installing GDAL 3.x during deployment is possible, but it's a lengthy compilation process that adds 10 minutes to every deployment. It's also error-prone because the compilation can fail if dependency versions change.

Your custom platform approach would be:

First, create a directory structure:

```
geospatial-python-platform/
├── builder/
│   ├── platform.yaml
│   └── scripts/
│       ├── install-gdal.sh
│       └── install-geopandas-deps.sh
└── hook_scripts/
    └── build_platform.sh
```

Your `platform.yaml` might look like:

```yaml
---
version: 1.0

builder:
  instance_type: m5.large
  source_ami: ami-0c55b159cbfafe1f0

commands:
  01_platform_json:
    command: |
      mkdir -p /opt/elasticbeanstalk/.platform
      cat > /opt/elasticbeanstalk/.platform/platform.json << 'EOF'
{
  "name": "Python with GDAL 3.x",
  "description": "Python 3.9 with GDAL 3.x for geospatial applications",
  "version": "1.0.0"
}
EOF
  
  02_install_base_deps:
    command: |
      yum update -y
      yum groupinstall -y "Development Tools"
  
  03_install_gdal_deps:
    command: |
      yum install -y \
        libcurl-devel \
        sqlite-devel \
        postgresql-devel
  
  04_build_gdal:
    command: bash /tmp/install-gdal.sh
  
  05_install_geopandas_deps:
    command: bash /tmp/install-geopandas-deps.sh
```

Your `install-gdal.sh` script would handle the GDAL compilation:

```bash
#!/bin/bash
set -e

cd /tmp

# Download GDAL 3.4.1
curl -O https://download.osgeo.org/gdal/3.4.1/gdal-3.4.1.tar.gz
tar xzf gdal-3.4.1.tar.gz
cd gdal-3.4.1

# Configure and compile with Python support
./configure \
  --with-python \
  --with-sqlite3 \
  --with-curl \
  --with-pg

make -j$(nproc)
make install

# Update library cache
ldconfig

# Verify installation
gdalinfo --version

cd /tmp
rm -rf gdal-3.4.1*
```

The `install-geopandas-deps.sh` would install Python-specific dependencies:

```bash
#!/bin/bash
set -e

# Install Shapely, Fiona, and other GeoPandas dependencies
# These need to find GDAL libraries we just compiled
export CPLUS_INCLUDE_PATH=/usr/local/include:$CPLUS_INCLUDE_PATH
export LD_LIBRARY_PATH=/usr/local/lib:$LD_LIBRARY_PATH

yum install -y \
  geos-devel \
  proj-devel

pip install --upgrade pip setuptools wheel
pip install Shapely Fiona rasterio geopandas
```

Once your custom platform is built and tested, every environment that uses it will have GDAL 3.x pre-compiled and ready to go. New instances launch with everything already in place. Deployments take minutes instead of twenty, and your team doesn't have to worry about compilation failures.

When you eventually need GDAL 3.5.x for some new feature, you create a new version of your custom platform (version 1.1.0), update the script, rebuild it, test it with your application, and then gradually roll it out to your environments. Different environments can be on different versions during the transition period, which is a safety feature that Docker doesn't provide without additional orchestration.

### Operational Overhead and Maintenance Considerations

Custom platforms aren't free. They require maintenance, and it's worth being honest about the costs before committing to them.

Building a custom platform adds a step to your development workflow. When you identify that you need new system dependencies, you can't just update a Dockerfile (as you would with Docker) and push a new image in seconds. Instead, you need to update your Packer template, rebuild the platform image, test it, and then deploy environments using the new version. This process might take 15-30 minutes from start to finish, depending on what you're compiling. It's not onerous, but it's real overhead.

Additionally, custom platforms need occasional updates. If you've baked GDAL 3.4.1 into your platform, and a security vulnerability is discovered in GDAL, you need to rebuild your platform with GDAL 3.4.2. This is part of your operational responsibility. It's similar to maintaining Dockerfiles, but it requires understanding Packer and Elastic Beanstalk's platform mechanics.

Another consideration is debugging. If an instance using your custom platform behaves unexpectedly, you need to understand what you built into the platform. Baking things into the platform image makes them harder to change on the fly. If you need to troubleshoot an issue with GDAL at runtime, you'll need to either log into an instance and inspect the platform directly, or rebuild the platform with additional debugging tools included. Docker offers more flexibility here: you can interactively inspect a running container without rebuilding anything.

Custom platforms also introduce a team knowledge requirement. Someone on your team needs to understand Packer, Elastic Beanstalk's platform structure, and your specific customizations. In smaller organizations, this can be a bottleneck. Docker's learning curve and industry familiarity mean that more developers can work with Docker-based deployments.

That said, if you're running multiple Elastic Beanstalk environments and want consistency across them, custom platforms shine. The one-time investment in building and versioning a platform pays dividends across a large fleet. The maintenance burden becomes shared across many environments rather than baked into each team's Docker image.

### Platform Comparison: Decision Matrix

Let's bring this together in a practical way. Here are the key factors to consider when choosing between managed platforms, custom platforms, and Docker:

Use a managed platform if your application fits neatly into what AWS provides, you have minimal custom system dependencies, and you value simplicity and rapid deployment. This is the path for most applications.

Use a custom platform if you're working within a language that Elastic Beanstalk supports, you have specific OS-level customizations that are needed consistently across environments, you want to maintain strong integration with Elastic Beanstalk's features (health monitoring, automatic scaling, deployment hooks), and you're willing to invest in versioning and maintaining a platform image for your organization.

Use Docker if your application uses a language or framework outside Elastic Beanstalk's platform support, you need maximum flexibility and control, you're already committed to containerization across your infrastructure, or if your requirements are so unique that baking them into an OS-level image makes less sense than building a complete container from scratch.

### Getting Started with Custom Platforms

If you've decided that custom platforms are the right fit for your use case, the practical starting point is the AWS documentation on Elastic Beanstalk custom platforms. AWS provides base images for each platform language, and you can clone or reference one to understand the structure.

Start small. Don't try to bake everything into your first custom platform. Add one or two key dependencies, build it, test it with an actual Elastic Beanstalk environment, and validate that your application runs correctly. Once you've got the workflow down, you can iterate and refine.

Use semantic versioning for your platform versions. Version 1.0.0 is your initial release, 1.1.0 adds a new dependency, 1.0.1 patches a security vulnerability in an existing dependency. This makes it clear what changed between versions and helps you and your team understand what each version is suitable for.

Document your platform. Include a README that explains what's installed, why it was chosen, and any gotchas or special considerations. This documentation is invaluable if someone else needs to update the platform or troubleshoot an issue.

### Conclusion

Custom platforms in Elastic Beanstalk represent a middle path between the convenience of managed platforms and the flexibility of Docker. They're powerful when applied to the right problem: when you need OS-level customization, want to maintain consistency across multiple environments, and value the tight integration that Elastic Beanstalk provides.

The key to using them well is being deliberate. Don't reach for custom platforms out of habit. Honestly evaluate whether your needs can be met by a managed platform with a few deployment-time customizations, or whether Docker would actually be simpler in the long run. But when you encounter that genuinely specialized requirement—when a managed platform lacks a critical library or when your runtime needs modifications—custom platforms provide a structured, versioned, maintainable way to build and deploy your customized environment.

Start with understanding your actual requirements, evaluate the three paths with the decision matrix in mind, and choose the one that lets your team focus on shipping great applications rather than wrestling with deployment infrastructure.
