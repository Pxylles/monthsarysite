// Edit this file whenever you want to change the passcode, the questions,
// or the final letter. The app logic reads everything from here.

window.defaultSiteContent = {
  brandLabel: "for her eyes only",

  // This is the editable 6 digit code used on the first screen.
  accessCode: "290629",

  // This protects the built-in browser editor.
  editorCode: "010101",

  lockScreen: {
    eyebrow: "Private access only",
    title: "This cute little place is only for you.",
    copy: "Type the secret 6 digit code and I will let you into the monthsary surprise.",
    hint: "Hint: it is a special date for us. You can edit this clue later.",
    errorCopy: "That is not the right code yet. Try the real six digits, baby.",
    buttonLabel: "Unlock the surprise",
  },

  intro: {
    eyebrow: "Third monthsary mission",
    title: "Before the final letter, answer a few tiny questions for me.",
    copy: "I wanted this to feel a little more alive than a normal webpage, so I turned it into a mini experience just for you.",
    buttonLabel: "Start the questions",
    sticker: "Cute mode activated",
    sideTitle: "What happens next?",
    sideCopy: "You answer the little prompts, I keep the vibe soft and sweet, and then the final envelope opens up with the letter at the end.",
    points: [
      { label: "Level of seriousness", value: "very soft" },
      { label: "Required energy", value: "just your smile" },
      { label: "Prize at the end", value: "one full letter" },
    ],
  },

  // Add more question objects to this array whenever you want.
  // Supported types right now: "choice" and "text"
  questions: [
    {
      id: "favorite-version",
      type: "choice",
      prompt: "Which version of us has felt the cutest lately?",
      note: "Pick the one that feels most like us right now.",
      options: [
        {
          label: "Soft and clingy",
          feedback: "That one has my whole heart too.",
        },
        {
          label: "Laughing at everything",
          feedback: "That is one of my favorite sounds in the world already.",
        },
        {
          label: "Calm and quiet together",
          feedback: "The peaceful version of us is dangerously lovely.",
        },
        {
          label: "All of the above, obviously",
          feedback: "Correct answer. You understand the assignment perfectly.",
        },
      ],
    },
    {
      id: "tiny-memory",
      type: "text",
      prompt: "Tell me one tiny moment from these first three months that you want us to keep forever.",
      note: "Short answer, long answer, sleepy answer, all accepted.",
      placeholder: "Type your little memory here...",
      buttonLabel: "Save this moment",
      feedback: "That one is going straight into the part of my brain labeled keep forever.",
    },
    {
      id: "next-date-vibe",
      type: "choice",
      prompt: "Pick a vibe for one of our next dates.",
      note: "I am taking notes, so choose carefully.",
      options: [
        {
          label: "Cafe and long talks",
          feedback: "Very us. Cozy table, good drinks, and way too much eye contact.",
        },
        {
          label: "Late walk and random stories",
          feedback: "That sounds like the kind of night I would replay in my head later.",
        },
        {
          label: "Stay in and be soft",
          feedback: "Honestly, that might be one of the strongest date formats ever made.",
        },
        {
          label: "Anything, as long as it is with you",
          feedback: "That answer is so unfairly sweet that I have to allow it.",
        },
      ],
    },
    {
      id: "note-before-letter",
      type: "text",
      prompt: "Write me one line before I let you open the envelope.",
      note: "This can be cute, teasing, dramatic, or all three.",
      placeholder: "Write your line here...",
      buttonLabel: "Send it to me",
      feedback: "Now I am smiling for real. You may open the final part next.",
    },
  ],

  questionFlow: {
    feedbackLabel: "Saved in the love vault",
    defaultFeedback: "I am keeping that one close.",
    nextLabel: "Next question",
  },

  finale: {
    eyebrow: "Last step",
    title: "Your envelope is waiting.",
    copy: "You made it through the little questions, and now the last part is ready. Tap the envelope when you want the letter to open.",
    buttonLabel: "Take me to the envelope",
    envelopeButtonLabel: "Open the envelope",
    openedButtonLabel: "Close the envelope",
    emptyAnswersCopy: "No answers were saved yet, but the letter is still here waiting for you.",
  },

  // Edit these paragraphs whenever you want to rewrite the final message.
  letter: {
    eyebrow: "The final letter",
    title: "Happy third monthsary, baby.",
    peekLabel: "love letter inside",
    peekCopy: "Open me when you are ready for the soft part.",
    sealLabel: "open",
    signoff: "Always yours.",
    paragraphs: [
      "Three months may sound small when written down, but being with you has made that time feel full in the best way. You have already become part of how I smile, how I wait for my phone, and how I picture comfort.",
      "I love how easy it feels to care about you. I love the way you make normal moments feel brighter, and I love that even the quiet parts with you still feel special. You are not just someone I like being around. You are someone I keep choosing in my head, even in the smallest moments.",
      "So this little website is my way of saying thank you for these first three months, and also saying that I want more of us. More laughs, more soft nights, more stories, more time, more memories. Happy monthsary, my love.",
    ],
  },

  gallery: {
    eyebrow: "Bonus memories",
    title: "Tiny things I want to keep.",
    items: [
      {
        title: "The way you make ordinary days softer",
        copy: "A little reminder that even normal moments with you count as memories to me.",
        photoUrl: "",
      },
      {
        title: "Every laugh I try to replay later",
        copy: "Some sounds stay in your head in the nicest way. Yours is one of them.",
        photoUrl: "",
      },
      {
        title: "The next memory we have not made yet",
        copy: "Leaving this space here for whatever sweet thing comes next.",
        photoUrl: "",
      },
    ],
  },
};
