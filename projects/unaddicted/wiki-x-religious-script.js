// Define an object of keywords and their corresponding Wikipedia URLs
const keywordToUrlMap = {
    'science': 'https://en.wikipedia.org/wiki/Science',
    'art': 'https://en.wikipedia.org/wiki/Art',
    'literature': 'https://en.wikipedia.org/wiki/Literature'
};

// Define an array of interesting websites related to God and spirituality
const spiritualWebsites = [
    'https://www.enlightened-spirituality.org/',
    'https://www.christianity.com/',
    'https://www.gotquestions.org/'
];

// Get the button element
const button = document.getElementById('redirect-button');

// Add a click event listener to the button
button.addEventListener('click', () => {
    // Randomly decide whether to redirect to a Wikipedia article or a spiritual website
    const redirectToSpiritual = Math.random() < 0.5;

    if (redirectToSpiritual) {
        // Redirect the user to a random spiritual website
        const randomIndex = Math.floor(Math.random() * spiritualWebsites.length);
        window.location.href = spiritualWebsites[randomIndex];
    } else {
        // Get a random keyword from the keywordToUrlMap object
        const keywords = Object.keys(keywordToUrlMap);
        const randomIndex = Math.floor(Math.random() * keywords.length);
        const randomKeyword = keywords[randomIndex];

        // Redirect the user to the corresponding Wikipedia article
        window.location.href = keywordToUrlMap[randomKeyword];
    }
});
