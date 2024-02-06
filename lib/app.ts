// Import necessary libraries or modules if any
// For example, importing a module to handle routing
// import { navigateTo } from 'your-routing-library';

// Function to handle clicking the 'Get Started' button
function handleGetStartedClick(): void {
    // Logic to handle the action after the 'Get Started' button is clicked
    // For the purpose of this example, we'll just log to the console
    console.log('Get Started button clicked!');

    // Here you might want to navigate to another route, e.g. sign up or contact page
    // navigateTo('/signup'); // Uncomment this and use actual routing logic if required
}

// Binding the click event to the 'Get Started' button on the landing page
window.onload = () => {
    const getStartedButton = document.querySelector('.btn-get-started');
    getStartedButton?.addEventListener('click', handleGetStartedClick);
};
