document.addEventListener('DOMContentLoaded', function () {
    // Ensure the button is enabled

    const form = document.getElementById('waitlist-form');
    const emailInput = document.getElementById('email');
    const ctaButton = document.getElementById('cta-btn');
    console.log(ctaButton);
    console.log(emailInput);
    ctaButton.addEventListener('click', () => {
        form.scrollIntoView({ behavior: 'smooth' });
        emailInput.focus();
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = emailInput.value.trim();

        if (email) {
            // Here, you can add code to send the email to your server or a third-party service
            console.log(`Waitlist email: ${email}`);
            alert('Thank you for joining the waitlist!');
            emailInput.value = '';
        } else {
            alert('Please enter a valid email address.');
        }
    });


});

