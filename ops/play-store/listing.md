# Google Play listing — copy for the console

Everything here is written to match what the code actually does. If a claim below
stops being true, fix the claim, not the form: a Data safety answer that overstates
or understates collection is a policy violation on its own.

## App details

| Field | Value |
|---|---|
| App name | Sahay |
| Package | `org.sahay.app` |
| Default language | English (United States) |
| App or game | App |
| Category | Social (alternative: Lifestyle) |
| Tags | Community, Volunteering |
| Free or paid | Free — no ads, no in-app purchases, no money moves through the app |
| Contact email | sahay4230@gmail.com |
| Website | https://sahay.online |
| Privacy policy | https://sahay.online/privacy |
| Account deletion | https://sahay.online/delete-account |

## Short description (80 char max)

```
Neighbors sharing essentials at community events — one request, one helper.
```
(75 characters.)

## Full description (4000 char max)

```
Sahay connects people who need a small essential item with someone nearby who has
one spare — during a relief operation, a festival, a campus event, or a community
kitchen.

Someone needs drinking water, a blanket, a phone charger, sanitary pads. Someone
fifty meters away is carrying exactly that. Sahay introduces the two of them, once,
and then gets out of the way.

HOW IT WORKS

• Join an event with a code, or find a public one.
• Say what you need — or list what you are carrying and switch on Helping Now.
• Sahay asks one nearby helper at a time, giving each a short window to accept, and
  widens the search until someone does.
• You get a one-time alias, a meeting point, and a short chat to arrange the handover.
• The exchange closes, the conversation is deleted, and nothing links you to the next one.

BUILT TO KNOW AS LITTLE AS POSSIBLE

• No real names, no photos, no phone numbers. You get a pseudonym, and a fresh alias
  inside every exchange, so nobody can follow you across exchanges.
• Your location is rounded to roughly 100 meters on your own device before it is sent,
  rounded again on the server, and deleted within 15 minutes. It is only used while you
  are actively requesting or helping.
• Your match partner never sees coordinates or distances — only "very nearby" or
  "a short walk away".
• There are no participant lists, no live maps, and no public profiles. Event statistics
  are only shown when enough different people contribute that no one can be singled out.
• You can export or permanently delete everything from Settings, at any time.

SAFETY

Report and Block are on every exchange, and reports go to human moderators who must
record a written reason for any action — which you can appeal. Meet in public places,
check sealed items before accepting, and cancel the moment you feel uneasy; there is a
dedicated action for that which ends the exchange immediately.

WHAT SAHAY IS NOT

Sahay is a free, community-run introduction service. It holds no goods, moves no money,
and charges nothing. It does not verify people or items, and it cannot guarantee that a
helper will be found or that anyone will arrive.

Sahay is not an emergency service. In a medical or safety emergency, contact your local
emergency number — in India, dial 112.

Available in English and Hindi.
```

## Data safety form

No analytics, advertising, or crash-reporting SDK is present in the app — verified
against `apps/mobile/package.json`. Nothing is collected for advertising or tracking.

**Global answers**
- Is all data encrypted in transit? **Yes** (HTTPS / WSS).
- Do you provide a way for users to request data deletion? **Yes** — in-app, plus
  https://sahay.online/delete-account
- Has your app been independently reviewed against a security standard? **No**.

**Data types to declare**

| Type | Collected | Shared | Required | Purpose |
|---|---|---|---|---|
| Personal → Email address | Yes | No | Required | Account management; encrypted at rest, never shown to other users |
| Location → Approximate location | Yes | No | Optional | App functionality (matching); rounded to ~100 m, deleted within 15 min |
| Messages → Other in-app messages | Yes | No | Optional | App functionality; deleted shortly after an exchange closes |
| App activity → Other user-generated content | Yes | No | Optional | Supplies listed, requests made, reports filed |
| Device or other IDs | Yes | No | Optional | Push notification delivery and the session list you can revoke |

Do **not** declare: name, phone number, photos, contacts, financial info, precise
location, health, browsing history, or app performance/diagnostics — none are collected.

Note on "Shared": Google FCM (push delivery) and Resend (the sign-in email) are service
providers processing data on your behalf, which Play's definition excludes from
"sharing". Answer No, and be ready to say why if asked.

## Content rating (IARC questionnaire)

- Category: **Social networking / communication**.
- Does the app let users interact or exchange content? **Yes** — in-exchange chat.
- Does it let users share their location with other users? **Judgement call, flag this
  one.** Users never see each other's coordinates or distances, only coarse proximity
  labels. Answering **Yes** is the conservative choice and unlikely to change the final
  rating, since user-to-user communication already drives it. Do not answer No without
  being prepared to defend it.
- Violence, sexual content, profanity, drugs, gambling, horror: **No** to all.
- Expected outcome: **Teen** (or PEGI 12 / equivalent).

## Target audience and content

- Target age group: **18 and over**. The app arranges in-person meetings between
  strangers; declaring 13+ pulls the app into the Families policy programme, which it is
  not built for.
- Appeals to children? **No**.
- Ads: **No ads**.

## App access (required — the app is login-gated)

Reviewers cannot receive an email OTP, so give them password credentials, not an OTP flow:

- Create a dedicated demo account and set a password on it.
- Keep one **event permanently active** with a few supplies listed, or the reviewer signs
  in and sees an empty app, which reads as a broken build.
- Instructions to paste into the App access form:
  1. Open the app and choose "I already have an account".
  2. Sign in with the email and password supplied.
  3. The demo event is already joined — open the Events tab to see it.

## Declarations

- Ads: no.
- Government app: no.
- Financial features: none.
- Health apps: no.
- News: no.
- COVID-19 / crisis: no. Sahay coordinates supplies, but makes no medical or public-health
  claims, and the listing states plainly that it is not an emergency service.
- Data safety: as above.
