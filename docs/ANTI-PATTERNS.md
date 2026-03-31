# ANTI-PATTERNS.md — AI Writing Patterns to Avoid

*Applies to ALL generated text: captions, slide texts, tweets, LinkedIn posts, descriptions, strategy notes — everything.*

*Sources: [Wikipedia:Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing), [stop-slop](https://github.com/hardikpandya/stop-slop), patterns observed in our own pipeline output.*

---

## The Core Problem

LLMs regress to the mean. Specific, unusual, real details get smoothed into generic, positive, interchangeable statements. The text becomes simultaneously less specific and more exaggerated — like a photograph fading into a blurry sketch while someone shouts louder about how important it is.

**The test:** Could this sentence apply to any event / any app / any product if you swapped the proper nouns? If yes, it's generic AI slop. Rewrite it.

---

## 1. Puffery & Inflated Significance

LLMs compulsively assert how important, meaningful, or transformative things are — even mundane things.

### Banned words/phrases:
- "testament to" / "is a testament"
- "stands as" / "serves as" (when you mean "is")
- "pivotal" / "crucial" / "vital" / "significant" / "key" (as filler adjectives)
- "underscores" / "highlights its importance"
- "reflects broader" / "symbolizing"
- "setting the stage for" / "marking/shaping the"
- "indelible mark" / "deeply rooted"
- "evolving landscape" / "focal point"
- "groundbreaking" / "revolutionary" / "game-changing"

### Instead:
State the fact. Let the reader decide if it's significant. "We sold out at 110 people" is more powerful than "This sold-out event underscored the vital role of community in shaping the evolving landscape of NYC live music."

---

## 2. Superficial Analysis via -ing Phrases

LLMs attach shallow analysis to the end of sentences using present participles. This is the single most detectable AI pattern.

### Examples to avoid:
- "...creating a vibrant community"
- "...highlighting the importance of..."
- "...showcasing the power of..."
- "...fostering a sense of connection"
- "...emphasizing the role of..."
- "...contributing to the broader..."
- "...reflecting the spirit of..."
- "...ensuring that..."
- "...cultivating a space where..."

### Instead:
End the sentence. If the analysis matters, give it its own sentence with a specific claim. Usually it doesn't matter — delete it.

---

## 3. Promotional / Ad-Copy Tone

LLMs default to press-release voice even when told to be casual.

### Banned words/phrases:
- "boasts a" (when you mean "has")
- "vibrant" / "rich" / "profound"
- "enhancing" / "showcasing" / "exemplifies"
- "commitment to" / "dedication to"
- "nestled" / "in the heart of"
- "diverse array" / "rich tapestry"
- "renowned" / "celebrated"
- "curated" (unless literally curated)
- "elevate" / "empower" / "leverage"
- "seamlessly" / "effortlessly"

### Instead:
Write like a person texting a friend, not a brand writing a press release. "we sold out" not "we showcased our commitment to community-driven artistic excellence."

---

## 4. AI Vocabulary (Dead Giveaways)

These words spike in AI-generated text and are statistically rare in human writing:

### High-signal AI words:
- **delve** (into)
- **tapestry** (figurative)
- **landscape** (figurative — "the music landscape")
- **intricate** / **intricacies**
- **meticulous** / **meticulously**
- **interplay**
- **bolstered**
- **garner** / **garnered**
- **foster** / **fostering**
- **underscore** (as a verb)
- **testament**
- **pivotal**
- **multifaceted**
- **nuanced** (when used as generic praise)
- **resonate** / **resonated** (overused — "this resonated with the community")
- **align with**
- **navigate** (challenges)
- **unpack** (analysis)

### Instead:
Use the simple word. "important" not "pivotal." "show" not "underscore." "connect" not "resonate." Or better — skip the word entirely and just state the fact.

---

## 5. Throat-Clearing & Announcement Phrases

LLMs announce what they're about to say before saying it. Cut to the point.

### Banned openers:
- "Here's the thing:"
- "Here's what/this/that [X]"
- "Here's why [X]"
- "The uncomfortable truth is"
- "It turns out"
- "The real [X] is"
- "Let me be clear"
- "The truth is,"
- "I'll say it again:"
- "I'm going to be honest"
- "Can we talk about"
- "Here's what I find interesting"
- "Here's the problem though"
- "Let me walk you through..."
- "In this section, we'll..."
- "I want to explore..."

### Banned emphasis crutches:
- "Full stop." / "Period."
- "Let that sink in."
- "This matters because"
- "Make no mistake"
- "Here's why that matters"

### Instead:
State the point. The reader doesn't need a runway.

---

## 6. Binary Contrasts & Negative Listings

LLMs love the "not just X, but Y" construction to appear thoughtful. It's a tell.

### Patterns to avoid:
- "It wasn't just about the music — it was about community"
- "Not just a concert, but a movement"
- "More than just an app — it's a platform for..."
- "This isn't just X, it's Y"
- "No [X], no [Y], just [Z]"
- "[X] isn't the problem. [Y] is."
- "The answer isn't X. It's Y."
- "It feels like X. It's actually Y."
- "stops being X and starts being Y"
- "Not a X... Not a Y... A Z." (negative listing)

### Instead:
Say Y directly. "The problem is Y." Drop the negation entirely. The reader doesn't need the striptease.

---

## 7. Rule of Three (Overused)

LLMs default to three-part lists compulsively: "artists, community, and connection" / "raw, authentic, and unforgettable."

### When to avoid:
- When two items would suffice
- When the third item is just padding ("innovative, groundbreaking, and transformative")
- When every sentence in a paragraph uses this pattern

### When it's fine:
- Listing actual things: "Layton Wu, Cecilian, and Nght"
- When three items genuinely exist and matter

---

## 8. False Agency & Passive Voice

LLMs give inanimate things human verbs to avoid naming the actor. Complaints don't "become" fixes. Decisions don't "emerge." Someone does something.

### Patterns to avoid:
- "a complaint becomes a fix" → someone fixed it
- "the decision emerges" → someone decided
- "the culture shifts" → people changed behavior
- "the data tells us" → someone read the data
- "the market rewards" → buyers pay for things
- "X was created" → name who created it
- "Mistakes were made" → name who made them

### Instead:
Name the human. "The team fixed it" beats "the complaint becomes a fix." Use "you" to put the reader in the seat.

---

## 9. Adverbs & Filler Words

Kill all adverbs. No -ly words. No softeners, no intensifiers, no hedges.

### Specific offenders:
- "really" / "just" / "literally" / "genuinely" / "honestly"
- "simply" / "actually" / "deeply" / "truly"
- "fundamentally" / "inherently" / "inevitably"
- "interestingly" / "importantly" / "crucially"

### Filler phrases:
- "At its core"
- "In today's [X]"
- "It's worth noting"
- "At the end of the day"
- "When it comes to"
- "In a world where"
- "The reality is"

### Instead:
Delete them. The sentence is stronger without them.

---

## 10. Elegant Variation (Synonym Cycling)

LLMs avoid repeating words by cycling through synonyms, making text feel robotic.

### Examples:
- "the event" → "the gathering" → "the evening" → "the experience" (all in one paragraph)
- "artists" → "performers" → "musicians" → "talent" (rotating for no reason)

### Instead:
Repeat the same word. Humans do this. "The show was great. People loved the show." sounds more human than "The event was extraordinary. Attendees cherished the experience."

---

## 11. Dramatic Fragmentation & Quotables

Sentence fragments for manufactured profundity. If it sounds like a pull-quote, rewrite it.

### Patterns to avoid:
- "[Noun]. That's it. That's the [thing]."
- "X. And Y. And Z." (staccato drama)
- "This unlocks something. [Word]."
- Consecutive short punchy sentences stacked for effect

### Instead:
Complete sentences. Trust content over presentation. Vary paragraph endings — don't always end with a zinger.

---

## 12. Narrator-from-a-Distance & Rhetorical Setups

Floating above the scene instead of putting the reader in it.

### Patterns to avoid:
- "Nobody designed this."
- "This happens because..."
- "People tend to..."
- "What if [reframe]?" (Socratic posturing)
- "Think about it:" (condescending)
- "And that's okay." (unnecessary permission)

### Instead:
Put the reader in the room. "You" beats "People." Specifics beat abstractions.

---

## 13. Fabrication & False Specificity

LLMs invent details to sound more specific. This is the most dangerous pattern.

### Rules:
- **Never state something as fact unless it's in the verified facts section**
- **Never invent sequence** ("opened the show", "closed the night") unless confirmed
- **Never attribute emotions to specific people** you can't observe
- **Never describe photos you haven't seen**
- **Never claim causation** ("this led to", "because of this event") without evidence
- **Never invent quotes**, reactions, or crowd behavior

### Instead:
If you don't know it, don't say it. "Three artists performed acoustic sets" is always better than "Layton Wu's sun-drenched melodies washed over the captivated audience as they swayed in unison."

---

## 14. Formulaic Structure

LLMs produce text in predictable patterns that humans recognize subconsciously.

### Patterns to avoid:
- Starting every caption with the same structure ("We're so excited...", "Still thinking about...")
- Hook → context → gratitude → CTA in every single post (vary the order)
- "Despite [challenge], [positive outcome]" formula
- "From X to Y" as an opening ("From an empty room to 110 people")
- Ending every post with "Thank you to everyone who..." / "We can't wait for..."
- Every paragraph ending with a punchy one-liner
- Wh- word sentence starters as a crutch ("What makes this hard is...")

### Instead:
Start some captions mid-thought. End some abruptly. Skip the thank-you on some. Let each post have its own shape. Read your batch out loud — if they all sound the same, they ARE the same.

---

## 15. Em Dashes & Punctuation

### Rules:
- Replace all em dashes (—) with hyphens (-)
- This applies to captions, slide texts, tweets, LinkedIn posts, everything
- No emoji at the end of every sentence
- No 🎶 and ✨ as default emojis on every post
- No exclamation marks on more than 30% of sentences
- Some posts have zero emoji. Vary it.

---

## Self-Check Before Submitting Any Text

1. **The swap test:** Replace the proper nouns with a competitor's. Does the text still work? → Too generic.
2. **The friend test:** Would you actually say this to a friend? "We're so excited to showcase our commitment to fostering community" → No human says this.
3. **The delete test:** Remove the sentence. Does the paragraph lose anything? If not, delete it.
4. **The repetition check:** Read the whole batch. Do 5+ posts start the same way? Fix it.
5. **The fact check:** Is every claim verifiable from the source material? If not, remove it.
6. **The adverb check:** Any -ly words? Kill them.
7. **The passive check:** Any passive voice? Find the actor, make them the subject.
8. **The contrast check:** Any "not X, it's Y" patterns? State Y directly.

### Scoring (from stop-slop)

Rate 1-10 on each dimension:

| Dimension | Question |
|-----------|----------|
| Directness | Statements or announcements? |
| Rhythm | Varied or metronomic? |
| Trust | Respects reader intelligence? |
| Authenticity | Sounds human? |
| Density | Anything cuttable? |

Below 35/50: revise.
