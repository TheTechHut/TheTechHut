// Define an array of interesting websites
const interestingWebsites = [
    'https://www.scientificamerican.com/',
    'https://www.tate.org.uk/',
    'https://www.litHub.com/',
    'https://www.nationalgeographic.com/',
    'https://www.nasa.gov/',
    'https://www.wikipedia.org/',
];

// Get the button element
const button = document.getElementById('redirect-button');

// Add a click event listener to the button
button.addEventListener('click', () => {
    // Randomly select an index from the interestingWebsites array
    const randomIndex = Math.floor(Math.random() * interestingWebsites.length);

    // Redirect the user to the selected website
    window.location.href = interestingWebsites[randomIndex];
});