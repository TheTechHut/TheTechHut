// Define an object of keywords and their corresponding Wikipedia URLs
const keywordToUrlMap = {
    'science': 'https://en.wikipedia.org/wiki/Science',
    'art': 'https://en.wikipedia.org/wiki/Art',
    'literature': 'https://en.wikipedia.org/wiki/Literature'
};

// Get the button element
const button = document.getElementById('redirect-button');

// Add a click event listener to the button
button.addEventListener('click', () => {
    // Get a random keyword from the keywordToUrlMap object
    const keywords = Object.keys(keywordToUrlMap);
    const randomIndex = Math.floor(Math.random() * keywords.length);
    const randomKeyword = keywords[randomIndex];

    // Redirect the user to the corresponding Wikipedia article
    window.location.href = keywordToUrlMap[randomKeyword];
});
