# What to say when someone messages to buy

The buy buttons currently open WhatsApp with the product and price written in.
That gets you the lead. Everything after it is you, so here is the script.

**One thing has to exist first.** You cannot take KSh 500 right now — your
IntaSend and Paystack links are all locked to other amounts. Before you promote
anything, make one payment link per product (two minutes each in either
dashboard) and paste it into the blanks below. Without that, the only option is
M-Pesa Send Money to your own number, which works but looks like lending a
friend airtime rather than buying a product.

---

## The flow

```
  they message  ->  you send the pay link  ->  they pay
                                                  |
                                   you see it in the dashboard
                                                  |
                                   you send what they bought
                                                  |
                                   you log the sale in the sheet
```

Median time once the links exist: under two minutes a sale. That is fine up to
about ten a week. Past that, finish the Paystack setup in `worker/README.md` and
the whole thing happens without you.

---

## Reply 1 — Remote-From-Kenya List (KSh 500)

> **They said:** Hi, I would like to buy the Remote-From-Kenya List (KSh 500).

Paste:

```
Asante for reaching out 🙏

The Remote-From-Kenya List is KSh 500, one payment, and you keep access
for good — it is rebuilt every morning from the employers' own feeds, so
it never goes stale.

Pay here: <YOUR KSH 500 LINK>

Send me a screenshot once it goes through and I will send your access
link right away. It usually takes me a few minutes.
```

Once you see the payment:

```
Got it, thank you! Here is your list:

https://thetechhut.co/remote/list/#16f1bf974ed1cd96

Bookmark that — it updates itself every morning, so check back rather
than applying from a copy.

Two things worth doing before you apply:
• The free CV pack, so your CV survives their system: thetechhut.co/cv-pack
• How to actually get paid from abroad: thetechhut.co/tools

Good luck, and tell me how it goes.
```

## Reply 2 — ATS Pass (KSh 1,000)

> **They said:** Hi, I would like to buy ATS Pass (KSh 1,000).

```
Happy to take this on.

ATS Pass is KSh 1,000 — I rebuild your CV for the exact hiring system
that employer runs, plus the keyword set for that specific role, back
within 24 hours on a working day.

Pay here: <YOUR KSH 1,000 LINK>

Then send me two things:
1. Your CV, however it looks right now — Word, PDF, even a photo
2. The link to the role you are going for (or the job title and company)

One round of changes is included. And if I look at your CV and think you
do not need this, I will say so and refund you.
```

After delivery:

```
Here is your CV, in two formats, plus the keyword notes.

The plain-text version shows you exactly what the parser sees — that is
the bit worth reading, because it is what gets you filtered or not.

Tell me what you would word differently and I will adjust it.
```

## Reply 3 — Job Hunt Bundle (KSh 1,500)

```
Good choice — that is the one that saves the most.

KSh 1,500 covers the Remote-From-Kenya List, the CV Blueprint and
templates, one ATS Pass, the community database, and three months of
Early Access. KSh 2,375 separately.

Pay here: <YOUR KSH 1,500 LINK>

Once it clears I will send the list, the blueprint and the database
straight away, add you to Early Access, and then we can start on your
ATS Pass whenever you have a role in mind.
```

## Reply 4 — Early Access (KSh 250 / 600 / 2,000)

```
Early Access is KSh 250 a month, or KSh 600 for three months, or
KSh 2,000 for the year. Nothing auto-renews — when you stop paying, it
stops.

What you get: every opening 24 hours before the public channel, screened
rather than scraped, a Monday shortlist, and a group small enough that
your questions actually get answered.

Pay here: <LINK FOR THE TERM THEY WANT>

Send me a screenshot and I will add you to the group today.

Fair warning: if you are not actively job hunting right now, do not pay
for it. The free channel will serve you fine.
```

## Reply 5 — someone wants it but cannot pay today

```
No problem at all — the free side is genuinely free and it is most of
what I make:

• Live jobs board: thetechhut.co/jobs
• The CV pack, including which system each employer runs:
  thetechhut.co/cv-pack
• How to get paid from abroad: thetechhut.co/tools

Come back when you are earning. I am not going anywhere.
```

---

## Log every sale

A sheet with: `date | name | WhatsApp | product | amount | paid? | delivered? | source`

Ten rows of that tells you which product to push and which to drop. Guessing
after a hundred sales is how people keep selling the wrong thing.

---

## Know this about the Remote List link

**Every buyer gets the same URL.** If one person forwards it to a WhatsApp
group, everyone in that group has your KSh 500 product for free. The page asks
them not to, which is a request rather than a lock.

Two ways out, when it starts to matter:

1. **Rotate the token.** Change `scripts/remote_token.txt`, redeploy, send
   existing buyers the new link. Cuts off a leak, annoys honest buyers.
2. **A token per buyer.** The Worker issues a unique link on each verified
   payment and stores it. Then a leak is traceable to one person and
   revocable on its own. Small change — ask me and I will build it.

Until you are selling a few a week, option zero (accept it, like the
communities database already does) is a reasonable business decision. Just make
it knowingly.
