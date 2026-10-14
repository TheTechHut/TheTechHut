/**
 * The CV keyword checklist: ONE source for the welcome email (this Worker) and
 * the Monday digest (scripts/send_digest.py reads this same file).
 *
 * Keep it valid JSON after the `=`: the Python side parses it. No comments
 * inside the object, no trailing commas.
 *
 * The family terms are words that recur in current postings (the rolling
 * counts in data/hiring-index.json are where the engineering ones come from).
 * The email tells people to use only the ones they have genuinely used.
 */
export const CHECKLIST = {
  "rules": [
    ["One column. Always.", "Two-column CVs with a coloured sidebar are read straight across the page by most parsers, so job titles end up merged with the skills list."],
    ["No tables, text boxes or icons.", "Taleo drops table contents entirely and icons become nothing. If a phone icon replaces the word Phone, some parsers lose your number. Write the words."],
    ["Use the boring headings.", "Work Experience, Education, Skills, Certifications. Parsers match headings against a fixed dictionary, so a creative heading means the section is never categorised."],
    ["Dates as MM/YYYY, right of the role.", "03/2024 – Present. Date parsing is how systems work out your years of experience, and that number is often a hard filter."],
    ["Mirror the posting's exact nouns.", "If the ad says Node.js, write Node.js, not Node or NodeJS. Keyword matching is literal. Put the stack in a Skills line and inside the bullet where you used it."],
    ["Submit a PDF, unless asked for Word.", "Modern systems parse PDF cleanly; Taleo and some Oracle setups still prefer .docx. Name it Firstname-Lastname-Role.pdf, never CV final v3."]
  ],
  "test": "Open your CV, select all, copy, and paste into a blank plain-text note. What you see is almost exactly what the parser sees. If the order is scrambled, the dates vanish or your name is missing, that is your rejection, before any human was involved.",
  "families": {
    "engineering": {"label": "Engineering", "terms": ["Python", "Java", "Go", "TypeScript", "JavaScript", "React", "Node.js", "Kotlin", "iOS", "Flutter", "PostgreSQL", "MongoDB", "Kafka", "Docker", "Kubernetes", "AWS", "CI/CD", "REST APIs", "DevOps", "SRE"]},
    "data": {"label": "Data", "terms": ["SQL", "Python", "ETL", "data modelling", "machine learning", "statistics", "dashboards", "A/B testing", "data pipelines"]},
    "product": {"label": "Product", "terms": ["product roadmap", "discovery", "user research", "prioritisation", "OKRs", "A/B testing", "stakeholder management", "SQL"]},
    "design": {"label": "Design", "terms": ["Figma", "user research", "prototyping", "design systems", "accessibility", "usability testing"]},
    "ops": {"label": "Operations, finance and other", "terms": ["process improvement", "SLAs", "stakeholder management", "budgeting and forecasting", "reporting", "KPIs", "vendor management"]}
  },
  "platforms": {
    "greenhouse": {"label": "Greenhouse", "tip": "Parses a plain PDF almost perfectly. Keyword search runs on the parsed text, so the words in your CV are the words recruiters find you by."},
    "ashby": {"label": "Ashby", "tip": "Clean parse, short form, structured screening questions. Your answers matter more than your CV design, and skills are matched as discrete tags, so name your stack explicitly."},
    "lever": {"label": "Lever", "tip": "Auto-fills the form from your CV or LinkedIn. Check what it filled in: a bad parse is the most common silent rejection. A second application to the same role does nothing."},
    "pinpoint": {"label": "Pinpoint", "tip": "Short, forgiving form. Volume is high across Africa, so being specific about your county and language skills genuinely helps."}
  }
};
