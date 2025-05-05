document.addEventListener('DOMContentLoaded', function () {
    // Ensure the button is enabled

    const form = document.getElementById('waitlist-form');
    const emailInput = document.getElementById('email');
    const ctaButton = document.getElementById('cta-btn');
    console.log(ctaButton);
    console.log(emailInput);
    ctaButton.addEventListener('click', () => {
        launchApp();
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = emailInput.value.trim();

        if (email) {
            handleSubmit(e);
            console.log(`Waitlist email: ${email}`);
            alert('Thank you for joining the waitlist!');
            emailInput.value = '';
        } else {
            alert('Please enter a valid email address.');
        }
    });

    const appButton = document.getElementById('launch-app-btn');

    appButton.addEventListener('click', () => {
        launchApp();
    });


});


async function handleSubmit(event) {
    const form = document.getElementById('waitlist-form');
    event.preventDefault();
    // var status = document.getElementById("my-form-status");
    var data = new FormData(event.target);
    fetch(event.target.action, {
        method: form.method,
        body: data,
        headers: {
            'Accept': 'application/json'
        }
    }).then(response => {
        if (response.ok) {
            alert("Thanks for your submission!");
            form.reset()
        } else {
            response.json().then(data => {
                if (Object.hasOwn(data, 'errors')) {
                    alert(data["errors"].map(error => error["message"]).join(", "));
                } else {
                    alert("Oops! There was a problem submitting your form")
                }
            })
        }
    }).catch(error => {
        alert("Oops! There was a problem submitting your form" + error.toString());
    });
}

async function launchApp() {
    const url = 'https://payment.intasend.com/pay/dc47452c-23d6-4805-aa01-33c64e99f68e/';
    window.open(url, '_blank');
}
