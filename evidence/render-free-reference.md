# Deploy for Free — Preview the Render platform with free web services and datastores.

You can deploy certain Render service types *free of charge*:

- Web services (web apps in Node.js, Python, Rails, etc.)
- Render Postgres databases
- Render Key Value instances

*Free instances have important limitations, described below. Do not use them for production applications.* However, they're perfect for testing out a new technology, working on a hobby project, or previewing Render's developer experience.

You can also deploy static sites on Render for free.

> Web services and static sites count against your monthly included amounts of outbound bandwidth and pipeline minutes.
>
> View your workspace's monthly included usage in the [Render Dashboard](https://dashboard.render.com/billing#included-usage).

## Create a Free instance

> For a more complete walkthrough, see [*Your First Render Deploy*](your-first-deploy).

1. [Sign up for Render](https://dashboard.render.com/register) if you haven't yet.
2. In the [Render Dashboard](https://dashboard.render.com), click *New*:

   [image: Selecting a service type from the New menu]

3. Select *Static Site*, *Web Service*, *Postgres*, or *Key Value*.
    - Other service types don't support Free instances.

4. During the service creation flow, you choose a *compute plan* for your service (unless it's a static site). Choose *Free*:

   [image: Selecting a web service compute plan]

That's it! When you finish creating and deploying your service, it runs on a Free instance.

See the sections below for details on the limitations of Free instances.

### Upgrading to a paid instance

To remove the Free instance limitations described below, you can upgrade your service to any paid compute plan. See [Changing a service's compute plan](compute-plans#changing-a-services-compute-plan).

> *Upgrading your workspace plan does _not_ remove limitations on Free instances.*
>
> Your workspace's plan only determines which [platform-level features](platform-features-by-plan) are available. You change a service's compute plan independently.

## Free web services

Free web services support many (but not all) features available to web services on paid compute plans. Supported features include:

- [Custom domains](custom-domains)
- [Managed TLS certificates](tls)
- [Service previews](service-previews)
- [Log streams](log-streams)
- [Rollbacks](rollbacks) (only to the two most recent previous deploys)

*Most limitations below are specific to web services on the Free compute plan.*

### Spinning down on idle

Render *spins down* a Free web service that goes 15 minutes without receiving any inbound traffic. This includes both HTTP requests and WebSocket messages from existing connections.

A Free web service spins back _up_ whenever it next receives an HTTP request or new WebSocket connection. This process takes about one minute. Render displays a loading page to connecting browsers while a service is spinning up.

Whenever a service spins down, any changes to its local filesystem are lost (see [Local files lost on redeploy](#local-files-lost-on-redeploy)).

### Local files lost on redeploy

Like all Render services, Free web services have an [ephemeral filesystem](/deploys#ephemeral-filesystem). This means that any changes to your web service's filesystem (uploaded images, local SQLite databases, etc.) are _lost_ every time the service redeploys, restarts, or [spins down](#spinning-down-on-idle).

*For long-term data storage:*

- _Paid_ services can preserve local filesystem changes by attaching a [persistent disk](disks), but Free web services _cannot_.
- Paid _and_ Free services can persist relational data in a [Render Postgres](postgresql-creating-connecting) database.
    - Note that Free Render Postgres databases [expire 30 days after creation](#30-day-limit).

### Monthly usage limits

#### Free instance hours

Render grants *750 Free instance hours* to each workspace per calendar month:

- A Free web service consumes these hours as long as it's running ([spun-down services](#spinning-down-on-idle) don't consume Free instance hours).
- If you consume all of your Free instance hours during a given month, Render *suspends* all of your Free web services until the start of the next month.
- At the start of each month, your Free instance hours reset to 750 (remaining hours don't roll over).

#### Bandwidth and build pipeline

Free web services count against your monthly included amounts of outbound bandwidth and build pipeline minutes.

- *If you consume all of your outbound bandwidth during a given month,* Render bills you for a supplementary amount.
  - If you haven't added a payment method, Render instead suspends all of your Free services for the remainder of the month.
- *If you consume all of your build pipeline minutes during a given month,* Render bills you for a supplementary amount (unless you've reached your [spend limit](build-pipeline#setting-a-spend-limit)).
  - If you haven't added a payment method or you reach your spend limit, Render instead disables all new builds for your workspace for the remainder of the month.
  - In this case, your services remain active using their existing build artifacts.

#### Tracking usage

View your usage details from the *Monthly Included Usage* section of your [Billing page](https://dashboard.render.com/billing#included-usage) in the Render Dashboard:

[image: Viewing usage in the Render Dashboard]

Render notifies you via email when you’re approaching a usage limit, and then again if you exceed that limit.

### Service-initiated traffic threshold

Render may suspend a Free web service that initiates an uncommonly high volume of traffic over the public internet.

Examples of service-initiated traffic include:

- Accessing an external database
- Invoking external APIs
- Transferring data to or from external object storage

If your service is suspended this way, you can restore it by moving it to any paid compute plan.

### Automatic `robots.txt` responses

While a Free web service is [spun down](#spinning-down-on-idle), incoming requests to the path `/robots.txt` automatically receive a standard "disallow all" response:

```text
User-agent: *
Disallow: /
```

These requests to do _not_ reach your service or trigger a spin-up.

While a Free web service is active, requests to `/robots.txt` are routed to it as normal.

### Other limitations

- Render might restart a Free web service at any time.
- Free web services don't support the following features of paid compute plans:
  - [Scaling](scaling) beyond a single instance
  - Persistent disks
  - [Edge caching](web-service-caching)
  - Running [one-off jobs](one-off-jobs)
  - [Shell access](ssh) via SSH or the Render Dashboard
- Free web services can't _receive_ private network traffic.
  - They can _send_ private network requests to your data stores and paid services in the same region.
- Free web services can't bind to Render's [reserved ports](web-services#port-binding) (`18012`, `18013`, or `19099`).
- Free web services can't send outbound network traffic on ports `25`, `465`, or `587`, commonly used for SMTP.
   - Render blocks outbound traffic on port `25` for _all_ services.

## Free Postgres

*The limitations below are specific to Render Postgres databases on the Free compute plan.* To avoid these limitations, you can upgrade your database to any paid compute plan.

### Single-instance limit

Only _one_ Free Render Postgres database can be active for any given workspace.

### 1 GB limit

Free Render Postgres databases have a fixed storage capacity of 1 GB.

### 30-day limit

*Free Render Postgres databases expire 30 days after creation.* An expired Free database is inaccessible unless you upgrade it to a paid compute plan.

After a Free database expires, you have a grace period of 14 days to upgrade it to a paid compute plan. After the grace period, Render *deletes* the database (along with all of its data).

Render notifies you via email when you’re approaching a Free database expiration, and then again when you're approaching the end of the grace period.

### Other limitations

- Render might perform maintenance on a Free Render Postgres database at any time. Your database is temporarily unavailable during maintenance.
- Render might restart a Free Render Postgres database at any time.
- Free Render Postgres databases don't support any form of [backups](postgresql-backups).
- Free Render Postgres databases don't support managed [connection pooling](postgresql-connection-pooling).

## Free Key Value

*The limitations below are specific to Render Key Value instances on the Free compute plan.* To avoid these limits, you can upgrade your instance to any paid compute plan.

### Single-instance limit

Only _one_ Free Key Value instance can be active for any given workspace.

### In-memory only

Unlike paid instances, Free Key Value instances do not continually persist their state to disk. This means that whenever an instance restarts, all of its data is lost.

### Other limitations

- Render might perform maintenance on a Free Render Key Value instance at any time. Your instance is temporarily unavailable during maintenance.
- Render might restart a Free Render Key Value instance at any time (thereby [deleting its data](#in-memory-only)).
- If you upgrade a Free Render Key Value instance to a paid compute plan, its data is lost during the upgrade process.

## Static sites

Static sites are free to deploy on Render. As with web services, they count against your monthly included amounts of outbound bandwidth and pipeline minutes. View your usage in the [Render Dashboard](https://dashboard.render.com/billing#included-usage).

---

##### Appendix: Glossary definitions

###### web service

Deploy this *service type* to host a dynamic application at a public URL.

Ideal for full-stack web apps and API servers.

Related article: https://render.com/docs/web-services.md

###### Render Postgres

Fully managed PostgreSQL databases that support point-in-time recovery, read replicas, high availability, and more.

Related article: https://render.com/docs/postgresql.md

###### Render Key Value

Fully managed, Redis®-compatible storage ideal for use as a job queue or shared cache.

Related article: https://render.com/docs/key-value.md

###### static site

Deploy this *service type* to host a static website (HTML/CSS/JS) over a global CDN at a public URL.

Related article: https://render.com/docs/static-sites.md

###### outbound bandwidth

The amount of network traffic you send to destinations outside of Render (HTTP responses, third-party API calls, and so on).

Your workspace receives a monthly included amount of outbound bandwidth. If you exceed this amount, Render bills you for a supplementary amount.

Related article: https://render.com/docs/outbound-bandwidth.md

###### pipeline minutes

The amount of time Render spends running *build commands* and *pre-deploy commands* for your services.

Your workspace receives a monthly included amount of pipeline minutes. If you exceed this amount, Render bills you for a supplementary amount.

Related article: https://render.com/docs/build-pipeline.md

###### compute plan

Specifies the CPU and RAM available to your service's *instances*.

Common compute plans for a new web service include:

- *`free`*: 0.1 CPU / 512 MB RAM
- *`0.5c-512mb`*: 0.5 CPU / 512 MB RAM
- *`1c-2g`*: 1 CPU / 2 GB RAM

Compute plans were previously known as *instance types*.

Related article: https://render.com/docs/compute-plans.md

###### persistent disk

A high-performance SSD that you can attach to a service to preserve filesystem changes across deploys and restarts.

Disables [zero-downtime deploys](/deploys#zero-downtime-deploys) for the service.

Related article: https://render.com/docs/disks.md

###### private network

Your Render services in the same *region* can reach each other without traversing the public internet, enabling faster and safer communication.

Related article: https://render.com/docs/private-network.md