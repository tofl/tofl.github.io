---
title: "Cognito Custom Domain and Hosted UI Customization"
---

## Cognito Custom Domain and Hosted UI Customization

When you're building applications that rely on AWS Cognito for authentication, one of the first things users encounter is the login interface. Out of the box, Cognito provides a hosted UI at a URL like `https://cognito-region.auth.amazoncognito.com`, which works perfectly well from a functionality standpoint. But there's a problem: it screams "AWS infrastructure" to your users. They see that domain, and suddenly your carefully crafted brand experience breaks the moment they need to authenticate.

This is where custom domains and UI customization come into play. By configuring a custom domain and tailoring the appearance of your Cognito hosted UI, you can create a seamless, branded authentication experience that feels like a natural extension of your application. In this guide, we'll walk through everything you need to know about setting up custom domains, configuring the necessary infrastructure, customizing the UI, and understanding the implications for your OAuth flows.

### Why Custom Domains Matter

Before diving into the technical details, let's talk about why this matters beyond aesthetics. A custom domain serves several important purposes in a production application.

First, it's about brand consistency. Users expect login flows to be hosted on your domain. When they're redirected to `cognito-region.auth.amazoncognito.com`, it creates a moment of cognitive friction—they've left your site, even though they're still in your authentication flow. With a custom domain like `auth.example.com`, the experience feels unified and professional.

Second, there's trust and perception. Revealing that you're using AWS Cognito, while not necessarily a negative thing, is a strategic decision. Some organizations prefer to abstract away their infrastructure choices from users. A custom domain gives you that control.

Third, there are subtle technical advantages. Custom domains allow you to maintain consistency across domain cookies and can simplify redirect URI management in certain multi-domain scenarios. They also give you flexibility if you ever need to migrate authentication providers in the future—your domain remains the same, even if the backend changes.

### Understanding the Architecture

To use a custom domain with Cognito's hosted UI, you need three key pieces in place: an SSL/TLS certificate, DNS configuration, and the custom domain setup within Cognito itself.

The SSL/TLS certificate must come from AWS Certificate Manager (ACM) and must cover your desired custom domain. This is a hard requirement—you cannot use certificates from other providers. The certificate needs to be in the same AWS region where your Cognito user pool is located.

Your DNS configuration routes traffic from your custom domain to AWS's Cognito endpoint. Depending on whether you use Route 53 or another DNS provider, the setup looks slightly different, but the principle is the same: you're creating a CNAME record that points your domain to the Cognito infrastructure.

Finally, within the Cognito console, you explicitly create the custom domain association, specifying which certificate to use and which user pool it applies to.

### Step-by-Step Setup: ACM Certificate

Let's start with the certificate. Navigate to AWS Certificate Manager in the same region as your Cognito user pool. Click "Request a certificate" and choose "Public certificate."

Enter your custom domain. If you want to use `auth.example.com`, enter that exact domain. You have the option to add additional domain names or subject alternative names (SANs) if needed. For instance, you might want both `auth.example.com` and `auth-staging.example.com` covered by a single certificate. You can add as many as you need.

Next, choose your validation method. Email validation sends a confirmation link to domain owners; DNS validation creates CNAME records in your DNS provider that prove domain ownership. For automated workflows and production environments, DNS validation is generally preferable because it can be fully automated through infrastructure-as-code tools.

If you choose DNS validation, AWS will provide you with the specific CNAME records to create. If you're using Route 53, you can often click a button within the ACM console to automatically create these records. If you're using a different DNS provider, you'll need to manually add them.

Once the certificate is validated and shows an "Issued" status, you're ready to proceed. Make a note of the certificate's ARN, as you'll need it when configuring the custom domain in Cognito.

### DNS Configuration: Route 53 vs External Providers

With your certificate in hand, you need to configure DNS. The approach varies slightly depending on whether you manage DNS with Route 53 or an external provider.

If you're using Route 53, the process is straightforward. Navigate to your Route 53 hosted zone and create a new record. Choose the record name—this should be your custom domain like `auth.example.com`. Set the record type to CNAME and point it to the value that Cognito will provide (more on that in the next section). Route 53 makes this easy because you can specify simple routing with a single target.

If you're using an external DNS provider like GoDaddy, Namecheap, or Cloudflare, you'll need to log into their console and manually create a CNAME record. The principle is identical: your custom domain should be a CNAME pointing to Cognito's endpoint. The exact steps depend on the provider's interface, but it's universally a straightforward process of adding a new DNS record.

One important caveat: CNAME records cannot exist at the root of a domain. If you want `example.com` itself to be your authentication domain (rather than a subdomain like `auth.example.com`), you'll need to use either a Route 53 alias record or an A record with appropriate routing. In practice, most organizations use a subdomain for their authentication endpoint, so this rarely becomes an issue.

### Creating the Custom Domain in Cognito

Now that your certificate exists and you've prepared your DNS configuration, it's time to configure the custom domain within your Cognito user pool.

Open the Cognito console and navigate to your user pool. In the left sidebar, you'll find "App integration" or a similar section depending on your console version, which contains "Domain name" or "Custom domain" settings.

Click on the option to create or configure a custom domain. You'll be presented with a form asking for your custom domain name and the ACM certificate ARN. Enter your domain (e.g., `auth.example.com`) and select the certificate you created earlier from the dropdown or by pasting its ARN.

When you click "Create custom domain," Cognito generates a CloudFront distribution behind the scenes and provides you with a distribution domain name. This is the CNAME target you need to add to your DNS configuration. If you haven't already created the DNS record, do so now, pointing your custom domain to this CloudFront distribution domain.

Cognito will show the status as "Creating" while it provisions everything. This typically takes 10 to 15 minutes. Once the status changes to "Active," your custom domain is live.

At this point, your custom domain is functional. You can navigate to `https://auth.example.com/.well-known/openid-configuration` and see your Cognito configuration, confirming that the domain is working correctly.

### Customizing the Hosted UI Appearance

With the custom domain in place, you can now customize how the hosted UI looks. Cognito provides several levels of customization, ranging from simple (upload a logo and choose colors) to advanced (write custom CSS).

Navigate to the "App client settings" or "App integration" > "App client settings" section of your user pool. Within the client settings, look for "UI customization" or "Hosted UI customization."

The simplest option is to upload a logo and choose a primary color. Upload your company's logo (typically a PNG or JPG around 200-300 pixels wide), select a primary color that matches your brand, and optionally a secondary color for interactive elements. The hosted UI immediately reflects these changes across the login, sign-up, and password reset pages.

For more control, Cognito allows you to provide custom CSS. This is where you can truly brand the experience. You can customize fonts, spacing, button styles, background colors, input field appearance, and more. The CSS you provide is injected into the hosted UI pages, allowing you to override default styles.

Here's an example of custom CSS that might be applied to a Cognito hosted UI:

```css
.logo-image {
  width: 300px;
  height: auto;
}

.submitButton-customizable {
  background-color: #2c3e50;
  border-color: #2c3e50;
  font-weight: bold;
  padding: 12px 24px;
  border-radius: 4px;
}

.submitButton-customizable:hover {
  background-color: #1a252f;
}

.label-customizable {
  color: #2c3e50;
  font-weight: 500;
}

.input-customizable {
  border: 2px solid #ecf0f1;
  border-radius: 4px;
  padding: 10px;
  font-size: 14px;
}

.input-customizable:focus {
  border-color: #3498db;
  outline: none;
}

.background-customizable {
  background-color: #f5f5f5;
}
```

You can customize the background, button styles, input fields, labels, text colors, and more. Cognito provides documentation listing all the available CSS class names you can target. The hosted UI doesn't support arbitrary HTML or JavaScript injection for security reasons, but CSS gives you tremendous flexibility in terms of appearance.

It's worth noting that customization is applied per-app client. If you have multiple applications using the same user pool, or multiple environments, you can customize the hosted UI differently for each. This allows you to tailor the experience for different contexts—perhaps your public-facing application has one brand, while your internal admin tools have another.

### OAuth Redirects and Custom Domains

When you use a custom domain, it affects how OAuth redirects work in your application. Your allowed callback URLs and sign-out URLs need to account for the custom domain you're using.

Let's say your application is at `app.example.com` and your Cognito custom domain is `auth.example.com`. In your app client settings, you'd configure allowed callback URLs like `https://app.example.com/callback` and `https://app.example.com/`. These remain unchanged—your application's domain doesn't need to match your Cognito domain.

However, when you construct OAuth authorization requests or configure OIDC discovery, you'll be using the custom domain. Instead of `https://cognito-region.auth.amazoncognito.com/oauth2/authorize`, you'd use `https://auth.example.com/oauth2/authorize`. Your OIDC discovery endpoint would be `https://auth.example.com/.well-known/openid-configuration`.

Most AWS SDKs and libraries handle this transparently. When you specify your Cognito domain in the SDK configuration, it automatically constructs the correct URLs. However, if you're building custom OAuth flows, or using a library that requires explicit endpoint configuration, you'll need to ensure you're using your custom domain.

One subtle but important point: if you ever migrate from the default Cognito domain to a custom domain, any pre-configured redirects or hard-coded URLs in your application will need to be updated. This is a good reason to use custom domains from the start if you're building a production application—it saves you from refactoring later.

### Troubleshooting Common Issues

Even with a clear setup process, issues can arise. Let's cover some of the most common ones.

A frequent problem is certificate validation failure. If your certificate isn't showing as "Issued" in ACM, check that you've completed the validation steps. For DNS validation, ensure the CNAME records are actually present in your DNS provider. Sometimes there's a delay before validation completes; check back after a few minutes. For email validation, look for the confirmation email in the mailbox specified in your domain's WHOIS records.

Another common issue is DNS propagation delays. After you create a CNAME record pointing to Cognito's CloudFront distribution, it can take several minutes to hours for DNS changes to propagate globally. If your custom domain isn't working immediately after setup, this is likely the cause. You can check DNS propagation using online tools, but generally, waiting 10-15 minutes and trying again solves the problem.

Certificate region mismatches cause subtle failures. Remember that your ACM certificate must be in the same region as your Cognito user pool. If you create a certificate in `us-east-1` but your user pool is in `eu-west-1`, you won't be able to use that certificate. Verify the region before attempting to associate the certificate.

If your custom domain shows an "Active" status but users are getting SSL certificate errors, double-check that the certificate covers your custom domain. A certificate for `auth.example.com` won't work for `auth.staging.example.com`—you'd need to add that as a subject alternative name when creating the certificate.

Finally, if UI customization isn't appearing, remember that CSS changes might be cached by browsers. Try accessing the hosted UI in an incognito or private browsing window, which bypasses cache. Also, verify that your CSS class names match exactly what Cognito expects—they're case-sensitive.

### Best Practices and Considerations

As you implement custom domains and UI customization, keep a few best practices in mind.

First, plan your domain structure early. Decide whether you'll use `auth.example.com`, `login.example.com`, or something else. This decision should align with your overall domain strategy. Once you've started distributing links to your login page, changing this later becomes more difficult.

Second, invest time in good UI customization. Your login page is often the first branded experience users have with your application. A polished, professionally customized login flow sets a positive tone. Conversely, a poorly customized login page with misaligned colors and clashing fonts damages your brand perception.

Third, test OAuth flows thoroughly after setup. Create a test application, go through the full authentication flow, and verify that redirects work correctly, tokens are issued, and user information is accessible. Test across different browsers and devices. Mobile browsers sometimes behave differently, particularly with cookies and cross-domain navigation.

Fourth, consider compliance and security implications. Your custom domain might be subject to organizational compliance requirements. If you're in a regulated industry, ensure that using a custom domain doesn't introduce any compliance gaps. Also, custom domains don't change Cognito's underlying security—traffic is still encrypted, credentials are still handled securely—but they do change the user's perception of where they're logging in.

Finally, monitor your custom domain after deployment. Set up CloudWatch alarms for your Cognito user pool to monitor authentication failures, token issuance rates, and other metrics. Custom domains don't change Cognito's operational characteristics, but they do change the user experience. If authentication starts failing, users will notice immediately, so keeping visibility into metrics is important.

### Moving Beyond Basics: Advanced Customization

Once you've mastered basic customization, there are additional techniques worth exploring.

You can use CSS to completely redesign the login page layout, changing where elements appear, their sizing, and spacing. Some organizations create login pages that are nearly unrecognizable as Cognito-hosted UIs, with custom backgrounds, animations, and layouts.

You can also leverage app client settings to customize the experience at a granular level. Different app clients can have different UI customizations, allowing you to present different login flows for different audiences. For instance, your public-facing application might have a consumer-friendly login flow, while your admin portal might have a different design.

For truly custom authentication experiences beyond what Cognito's hosted UI supports, consider using Cognito's authentication API directly. Rather than using the hosted UI, you can call Cognito's API endpoints from your own custom-built login page. This gives you complete control over the UI but also means you're responsible for properly implementing security best practices, handling password storage, and managing tokens. This approach is more complex and typically reserved for situations where the hosted UI customization doesn't meet your requirements.

### Conclusion

Custom domains and UI customization transform Cognito from a generic, AWS-branded authentication service into a seamlessly integrated component of your application. By configuring a custom domain, you get a professional, branded authentication experience that users perceive as part of your application rather than an external service. The process—while requiring coordination between ACM, DNS, and Cognito—is straightforward and well-supported by AWS tooling.

The effort you invest in setting up a custom domain and customizing the UI pays dividends in user perception and brand consistency. A polished login experience signals professionalism and care, while a generic login page suggests a hastily assembled application.

As you move forward, remember that custom domains and UI customization are just two levers in Cognito's broader customization toolkit. Cognito also supports custom auth flows, Lambda triggers, and fine-grained user pool policies that allow you to extend authentication in countless ways. But for most applications, a well-configured custom domain with thoughtful UI customization provides the perfect balance between powerful built-in functionality and branded user experience.
