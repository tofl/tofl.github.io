---
title: "30. ACM / ACM Private CA"
type: docs
weight: 3
---

## ACM / ACM Private CA

TLS certificates are what enable HTTPS — they authenticate your server's identity and encrypt traffic between clients and your application. Without them, browsers display security warnings and connections are unencrypted. The problem they solve sounds simple, but managing certificates manually is error-prone: you have to generate them, validate domain ownership, deploy them to the right services, and renew them before they expire (typically every 13 months). A missed renewal causes an outage. **AWS Certificate Manager (ACM)** [🔗](https://docs.aws.amazon.com/acm/latest/userguide/acm-overview.html) automates all of this — provisioning, validation, deployment, and renewal — at no cost for certificates used with supported AWS services.

### Public Certificates and Domain Validation

When you request a public certificate from ACM, AWS needs to verify that you actually own the domain before issuing it. There are two validation methods:

- **DNS validation** (recommended): ACM gives you a CNAME record to add to your domain's DNS configuration. Once the record is present, ACM can validate the domain automatically and — crucially — renew the certificate automatically before it expires, as long as the CNAME remains in place. If your domain is hosted in Route 53, ACM can insert the record for you in one click.
- **Email validation**: ACM sends a validation email to the registered contacts for the domain (from WHOIS data) and to common administrative addresses like `admin@yourdomain.com`. Someone must click the approval link. This method does **not** support automatic renewal in the same seamless way, because a human has to re-approve each time.

For anything production-facing, DNS validation is the right choice. It removes the human step and keeps renewals fully automated.

### Certificate Auto-Renewal

ACM handles renewal automatically for certificates that are in use with a supported AWS service and have passed DNS validation. ACM begins attempting renewal 60 days before expiry [🔗](https://docs.aws.amazon.com/acm/latest/userguide/managed-renewal.html). You don't need to do anything — the renewed certificate is deployed to the integrated service without downtime. This is the core value proposition: you issue it once and ACM manages the lifecycle indefinitely.

### ACM Integrations

ACM certificates are **not general-purpose files you download and install anywhere**. They can only be deployed directly to specific AWS services that have native ACM integration:

- **Application Load Balancer (ALB)** — the most common pattern. The ALB terminates TLS using the ACM certificate, then forwards plain HTTP to your backend targets. This offloads encryption processing from your application servers.
- **CloudFront** — attach an ACM certificate to a distribution to serve your content over HTTPS. Note that certificates for CloudFront must be provisioned in **us-east-1** (N. Virginia), regardless of where your distribution serves traffic.
- **API Gateway** — attach a certificate to a custom domain name on your API.

Other supported services include Elastic Load Balancing (Classic and Network), AWS App Runner, and CloudFormation-managed resources. [🔗](https://docs.aws.amazon.com/acm/latest/userguide/acm-services.html)

### The Private Key Limitation

This is a frequently tested constraint: **ACM does not allow you to export the private key of a public certificate**. The private key is generated and stored inside ACM, and it never leaves AWS. This is intentional — it prevents the key from being exposed or mishandled.

The practical implication is that you cannot use an ACM public certificate on an EC2 instance, an on-premises server, or any other service that isn't in the ACM integration list above. For those use cases, you need to obtain a certificate from another CA and install it manually, or use ACM Private CA.

### ACM Private CA

**ACM Private CA** [🔗](https://aws.amazon.com/private-ca/) is a separate service that lets you operate your own private certificate authority within AWS. Rather than issuing publicly trusted certificates (the kind browsers recognise), Private CA issues certificates that are trusted only within your organisation — you control the trust chain entirely.

This is useful for internal services that still need TLS but don't have public-facing domain names: microservices communicating inside a VPC, internal APIs, IoT devices, or mTLS (mutual TLS) authentication between services. Because you control the CA, you can also issue certificates with custom validity periods, custom subject fields, and custom extensions that a public CA like ACM wouldn't allow.

Unlike public ACM certificates, **Private CA certificates can be exported** — you receive the certificate and private key, which means you can install them on EC2 instances, containers, or on-premises systems. The trade-off is cost: ACM Private CA has a monthly fee per CA plus a per-certificate charge, whereas public ACM certificates are free for use with integrated services. [🔗](https://aws.amazon.com/private-ca/pricing/)

| | ACM Public Certificates | ACM Private CA |
|---|---|---|
| Trust | Publicly trusted (browsers) | Private / internal only |
| Use with ALB / CloudFront / APIGW | ✅ | ✅ |
| Use on EC2 / on-prem | ❌ | ✅ (exportable) |
| Private key export | ❌ | ✅ |
| Auto-renewal | ✅ | Manual or scripted |
| Cost | Free | Paid per CA + per certificate |

{{< qcm >}}
[
{
"question": "A company wants to enable HTTPS on their Application Load Balancer using AWS Certificate Manager. Which domain validation method should they use to ensure certificates are renewed automatically without any manual intervention?",
"answers": [
{
"answer": "DNS validation",
"isCorrect": true,
"explanation": "DNS validation uses a CNAME record to prove domain ownership, and as long as that record remains in place, ACM can renew the certificate automatically without any human action."
},
{
"answer": "Email validation",
"isCorrect": false,
"explanation": "Email validation requires a human to click an approval link each time the certificate is renewed, making it unsuitable for fully automated renewal workflows."
},
{
"answer": "HTTP file validation",
"isCorrect": false,
"explanation": "ACM does not offer HTTP file-based validation. The two supported methods are DNS validation and email validation."
}
]
},
{
"question": "A developer is setting up a CloudFront distribution and wants to attach a custom ACM certificate to serve content over HTTPS. In which AWS region must the certificate be provisioned?",
"answers": [
{
"answer": "us-east-1 (N. Virginia)",
"isCorrect": true,
"explanation": "CloudFront requires ACM certificates to be provisioned specifically in us-east-1, regardless of where the distribution serves traffic. This is a hard constraint in ACM's CloudFront integration."
},
{
"answer": "The region where the CloudFront distribution was created",
"isCorrect": false,
"explanation": "CloudFront is a global service and distributions are not tied to a specific region. The certificate must always be in us-east-1, no matter where the content is served."
},
{
"answer": "Any AWS region, as ACM certificates are globally replicated",
"isCorrect": false,
"explanation": "ACM certificates are regional resources and are not globally replicated. For CloudFront specifically, the certificate must reside in us-east-1."
},
{
"answer": "us-west-2 (Oregon), the default AWS region",
"isCorrect": false,
"explanation": "There is no single default AWS region, and CloudFront certificates must be provisioned in us-east-1, not any other region."
}
]
},
{
"question": "A company hosts its domain in Amazon Route 53 and is requesting a public certificate from ACM using DNS validation. What advantage does Route 53 provide in this scenario?",
"answers": [
{
"answer": "ACM can automatically insert the required CNAME validation record into Route 53 in one click",
"isCorrect": true,
"explanation": "When a domain is hosted in Route 53, ACM integrates directly and can add the CNAME record needed for DNS validation automatically, removing the need to manually update DNS settings."
},
{
"answer": "Route 53 bypasses the need for domain validation entirely",
"isCorrect": false,
"explanation": "Domain validation is always required when issuing a public ACM certificate. Route 53 simplifies the process but does not eliminate the validation step."
},
{
"answer": "Route 53 allows ACM to use email validation without requiring human approval",
"isCorrect": false,
"explanation": "Email validation always requires human approval regardless of the DNS provider. Route 53 only simplifies DNS validation, not email validation."
}
]
},
{
"question": "An application team needs to install a TLS certificate on a fleet of EC2 instances running a custom TCP server. They want to use AWS Certificate Manager to provision the certificate. What is a key limitation they must be aware of?",
"answers": [
{
"answer": "ACM public certificates cannot be exported, so their private key cannot be installed on EC2 instances",
"isCorrect": true,
"explanation": "ACM intentionally prevents the export of private keys for public certificates. Since EC2 instances are not a natively integrated ACM service, the certificate cannot be deployed there directly."
},
{
"answer": "ACM certificates are only valid for 90 days and cannot be used on EC2",
"isCorrect": false,
"explanation": "ACM-managed certificates are typically valid for 13 months and are renewed automatically. The limitation for EC2 is the inability to export the private key, not certificate duration."
},
{
"answer": "ACM certificates require an Application Load Balancer to function",
"isCorrect": false,
"explanation": "ACM supports several services beyond ALB, including CloudFront and API Gateway. However, EC2 instances are not among the natively integrated services, and private key export is not allowed."
},
{
"answer": "ACM does not support certificates for EC2 because EC2 cannot handle TLS termination",
"isCorrect": false,
"explanation": "EC2 instances are fully capable of handling TLS termination. The issue is that ACM does not allow private key export, not any technical limitation of EC2 itself."
}
]
},
{
"question": "A company needs to issue TLS certificates for internal microservices running inside a VPC. The certificates must be installable on EC2 instances and containers. They also need custom validity periods. Which solution meets these requirements?",
"answers": [
{
"answer": "ACM Private CA",
"isCorrect": true,
"explanation": "ACM Private CA allows you to operate your own certificate authority, issue certificates with custom validity periods and extensions, and export the certificates (including the private key) for installation on EC2, containers, or on-premises systems."
},
{
"answer": "ACM public certificates",
"isCorrect": false,
"explanation": "Public ACM certificates cannot be exported and their private keys never leave ACM. They also cannot be installed directly on EC2 instances, making them unsuitable for this use case."
},
{
"answer": "AWS Secrets Manager with a self-generated certificate",
"isCorrect": false,
"explanation": "While Secrets Manager can store certificates, it is not a certificate authority and does not issue or manage TLS certificates. ACM Private CA is the purpose-built service for this need."
},
{
"answer": "AWS IAM server certificates",
"isCorrect": false,
"explanation": "IAM server certificates are a legacy mechanism for uploading third-party certificates to use with some AWS services. They do not function as a CA and are not suited for issuing certificates to internal services."
}
]
},
{
"question": "Which of the following AWS services can have an ACM public certificate directly attached to them? (Select TWO)",
"answers": [
{
"answer": "Application Load Balancer (ALB)",
"isCorrect": true,
"explanation": "ALB is a natively integrated ACM service. It terminates TLS using the ACM certificate and forwards plain HTTP to backend targets, which is one of the most common ACM usage patterns."
},
{
"answer": "Amazon CloudFront",
"isCorrect": true,
"explanation": "CloudFront natively integrates with ACM. You can attach an ACM certificate (provisioned in us-east-1) to a CloudFront distribution to serve content over HTTPS."
},
{
"answer": "Amazon EC2",
"isCorrect": false,
"explanation": "EC2 is not a natively integrated ACM service. Because ACM does not allow private key export, you cannot install a public ACM certificate directly on an EC2 instance."
},
{
"answer": "Amazon RDS",
"isCorrect": false,
"explanation": "Amazon RDS is not in the list of ACM-integrated services. RDS manages its own TLS certificates for database connections separately."
},
{
"answer": "AWS Lambda",
"isCorrect": false,
"explanation": "Lambda functions are not a direct ACM integration target. TLS termination for Lambda-backed APIs is typically handled by API Gateway, which does support ACM."
}
]
},
{
"question": "How early does ACM begin attempting to automatically renew a certificate before it expires?",
"answers": [
{
"answer": "60 days before expiry",
"isCorrect": true,
"explanation": "ACM starts the managed renewal process 60 days before a certificate's expiration date, giving enough time to complete validation and deploy the renewed certificate without downtime."
},
{
"answer": "30 days before expiry",
"isCorrect": false,
"explanation": "ACM begins renewal attempts 60 days before expiry, not 30. Starting earlier provides a longer window to resolve any validation issues."
},
{
"answer": "7 days before expiry",
"isCorrect": false,
"explanation": "Waiting until 7 days before expiry would be dangerously short. ACM starts the renewal process 60 days in advance."
},
{
"answer": "Renewal is triggered immediately after issuance for the next cycle",
"isCorrect": false,
"explanation": "ACM does not begin renewal immediately after issuance. It monitors expiration dates and starts the renewal process 60 days before the certificate expires."
}
]
},
{
"question": "A developer is configuring an API Gateway custom domain name and wants to use HTTPS. Which of the following statements is correct regarding ACM certificate usage with API Gateway?",
"answers": [
{
"answer": "You can attach an ACM certificate directly to a custom domain name in API Gateway",
"isCorrect": true,
"explanation": "API Gateway is a natively supported ACM integration. You can provision a certificate in ACM and attach it to a custom domain name on your API to enable HTTPS."
},
{
"answer": "API Gateway manages its own certificates and cannot use ACM",
"isCorrect": false,
"explanation": "API Gateway does support ACM integration for custom domain names. You do not have to rely solely on API Gateway's default endpoint certificate."
},
{
"answer": "ACM certificates for API Gateway must be provisioned in us-west-2",
"isCorrect": false,
"explanation": "The us-east-1 regional requirement applies specifically to CloudFront, not API Gateway. For API Gateway, the certificate should be in the same region as the API."
}
]
},
{
"question": "A security team requires mutual TLS (mTLS) between internal services. The certificates must be trusted only within the organization and must be installable on containers. Which AWS service best supports this requirement?",
"answers": [
{
"answer": "ACM Private CA",
"isCorrect": true,
"explanation": "ACM Private CA is designed exactly for this: it issues privately trusted certificates that are exportable (including the private key), supports mTLS use cases, and allows custom certificate configurations for internal services."
},
{
"answer": "ACM public certificates",
"isCorrect": false,
"explanation": "Public ACM certificates are publicly trusted and their private keys cannot be exported, making them unusable for mTLS on containers or any service outside the ACM integration list."
},
{
"answer": "AWS KMS with customer-managed keys",
"isCorrect": false,
"explanation": "KMS manages encryption keys, not TLS certificates. It does not function as a certificate authority and cannot issue X.509 certificates for mTLS."
},
{
"answer": "AWS IAM with role-based authentication",
"isCorrect": false,
"explanation": "IAM provides identity-based access control using roles and policies, not TLS certificate-based mutual authentication. mTLS requires X.509 certificates, which IAM does not issue."
}
]
},
{
"question": "A team is evaluating the cost implications of using ACM versus ACM Private CA for their certificate needs. Which of the following statements accurately describes the pricing difference?",
"answers": [
{
"answer": "Public ACM certificates are free for use with integrated AWS services, while ACM Private CA charges a monthly fee per CA plus a per-certificate fee",
"isCorrect": true,
"explanation": "ACM public certificates are provided at no cost when used with supported services like ALB, CloudFront, or API Gateway. ACM Private CA has a separate pricing model with charges per CA per month and per certificate issued."
},
{
"answer": "Both ACM and ACM Private CA are free up to a certain number of certificates per month",
"isCorrect": false,
"explanation": "Public ACM certificates are always free for integrated services, but ACM Private CA has a paid pricing model with no free tier for the CA itself."
},
{
"answer": "ACM Private CA is free, but you pay for each certificate issued with a public ACM CA",
"isCorrect": false,
"explanation": "This is the opposite of the actual pricing. Public ACM certificates are free; ACM Private CA incurs both a monthly CA fee and a per-certificate charge."
},
{
"answer": "Both services charge per certificate, but ACM Private CA certificates cost less because they are not publicly trusted",
"isCorrect": false,
"explanation": "Public ACM certificates are free for use with integrated services. ACM Private CA is the paid option, not the cheaper one."
}
]
},
{
"question": "An application currently uses ACM certificates on an Application Load Balancer. The team wants to expand to serve an on-premises legacy system using the same certificate. What should they do?",
"answers": [
{
"answer": "Obtain a certificate from ACM Private CA or a third-party CA and install it on the on-premises system, since ACM public certificates cannot be exported",
"isCorrect": true,
"explanation": "ACM public certificate private keys cannot be exported. On-premises systems are not part of ACM's native integrations, so the team must use ACM Private CA (which supports export) or an external CA to get a certificate they can install manually."
},
{
"answer": "Export the ACM certificate from the AWS Console and copy it to the on-premises server",
"isCorrect": false,
"explanation": "ACM explicitly prevents the export of public certificate private keys. There is no console option to download the private key of a public ACM certificate."
},
{
"answer": "Use AWS Systems Manager to push the ACM certificate to on-premises servers",
"isCorrect": false,
"explanation": "Systems Manager cannot push ACM certificate private keys to on-premises systems because ACM does not expose them. The private key never leaves ACM for public certificates."
},
{
"answer": "Create an additional ACM certificate for the on-premises system using a different validation method",
"isCorrect": false,
"explanation": "Changing the validation method does not affect the private key export restriction. ACM public certificates cannot have their private keys exported regardless of how they were validated."
}
]
},
{
"question": "What happens to an ACM-managed certificate renewal if the DNS CNAME validation record is removed from the domain's DNS configuration?",
"answers": [
{
"answer": "ACM will no longer be able to automatically renew the certificate, potentially causing it to expire",
"isCorrect": true,
"explanation": "The DNS CNAME record must remain in place for ACM to perform automatic DNS-based validation during renewal. If it is removed, ACM cannot complete the renewal process and the certificate will eventually expire."
},
{
"answer": "ACM will switch to email validation automatically and send a renewal notification",
"isCorrect": false,
"explanation": "ACM does not automatically fall back to email validation. If the CNAME is missing, the renewal attempt will fail, not silently switch methods."
},
{
"answer": "The certificate will be renewed based on the original validation and the CNAME is only needed once",
"isCorrect": false,
"explanation": "The CNAME record must remain present for ongoing automatic renewal. It is not a one-time-use record — ACM checks it each time a renewal needs to occur."
},
{
"answer": "ACM will pause renewal and alert the account owner via AWS Health Dashboard, then retry indefinitely",
"isCorrect": false,
"explanation": "While ACM may surface renewal issues via AWS Health, the root cause here is that without the CNAME, validation cannot succeed. ACM will not retry indefinitely without the record being restored."
}
]
},
{
"question": "Which of the following are valid differences between ACM Public Certificates and ACM Private CA certificates? (Select THREE)",
"answers": [
{
"answer": "ACM Public Certificates are trusted by browsers; Private CA certificates are trusted only within the organization",
"isCorrect": true,
"explanation": "Public ACM certificates are issued by a publicly trusted CA and are recognized by browsers. Private CA certificates establish an internal trust chain and are only trusted by systems configured to trust that private CA."
},
{
"answer": "Private CA certificates can be exported and installed on EC2 or on-premises systems; public ACM certificates cannot",
"isCorrect": true,
"explanation": "ACM Private CA allows certificate export (including the private key), enabling installation on any system. Public ACM certificates cannot have their private keys exported."
},
{
"answer": "Public ACM certificates are free for use with integrated services; ACM Private CA has a per-CA and per-certificate cost",
"isCorrect": true,
"explanation": "This is a key cost distinction. Public ACM certificates cost nothing when used with supported AWS services, while ACM Private CA charges a monthly fee per CA plus a fee per certificate issued."
},
{
"answer": "Private CA certificates automatically renew like public ACM certificates",
"isCorrect": false,
"explanation": "Automatic renewal is a feature of public ACM certificates. ACM Private CA certificates require manual or scripted renewal processes — there is no built-in automatic renewal equivalent."
},
{
"answer": "Public ACM certificates support custom validity periods; Private CA certificates use fixed 13-month periods",
"isCorrect": false,
"explanation": "This is backwards. ACM Private CA supports custom validity periods and extensions. Public ACM certificates use standard validity periods managed by ACM."
}
]
},
{
"question": "A company uses an Application Load Balancer with an ACM certificate. What is the TLS termination behavior in this setup?",
"answers": [
{
"answer": "The ALB terminates TLS using the ACM certificate and forwards plain HTTP to backend targets",
"isCorrect": true,
"explanation": "This is the standard ALB + ACM pattern. The ALB handles TLS termination, decrypting incoming HTTPS traffic and forwarding it as plain HTTP to backend instances, offloading the encryption workload from application servers."
},
{
"answer": "The ALB passes encrypted traffic through to backend targets, which terminate TLS using the ACM certificate",
"isCorrect": false,
"explanation": "This describes TLS passthrough, which is not how ACM integrates with ALB. The ALB itself terminates TLS; backend targets receive plain HTTP. For passthrough, you would use a Network Load Balancer."
},
{
"answer": "The ACM certificate is replicated to each backend EC2 instance for local TLS termination",
"isCorrect": false,
"explanation": "ACM certificates are never replicated or exported to EC2 instances. The ALB holds and uses the certificate for TLS termination centrally."
}
]
},
{
"question": "A developer registers a new public certificate in ACM for a domain hosted on a third-party DNS provider (not Route 53) and selects DNS validation. What must the developer do to complete validation?",
"answers": [
{
"answer": "Manually add the CNAME record provided by ACM to the domain's DNS configuration on the third-party provider",
"isCorrect": true,
"explanation": "When the domain is not in Route 53, ACM cannot insert the CNAME record automatically. The developer must log into the DNS provider's console and manually create the CNAME record that ACM specifies."
},
{
"answer": "Nothing — ACM will validate the domain automatically regardless of DNS provider",
"isCorrect": false,
"explanation": "ACM can only auto-insert the CNAME record when the domain is hosted in Route 53. For third-party DNS providers, manual intervention is required."
},
{
"answer": "Migrate the domain to Route 53 before ACM can issue the certificate",
"isCorrect": false,
"explanation": "DNS validation works with any DNS provider. Migration to Route 53 is not required — it only simplifies the process by enabling one-click record insertion."
},
{
"answer": "Switch to email validation, as DNS validation only works with Route 53",
"isCorrect": false,
"explanation": "DNS validation works with any DNS provider; it is not limited to Route 53. The developer just needs to add the CNAME record manually."
}
]
}
]
{{< /qcm >}}