const form = document.getElementById('storyForm');

form.addEventListener('submit', (e) => {
    e.preventDefault();

    handleSubmit(e);
    // Here you can handle the form submission (e.g., send to server)
    // alert('Thank you for sharing your story!');
    form.reset();
});

function createCircles() {
    for (let i = 0; i < 20; i++) {
        const circle = document.createElement('div');
        circle.classList.add('circle');
        const size = Math.random() * 100 + 50; // Random size between 50px and 150px
        circle.style.width = circle.style.height = `${size}px`;
        circle.style.top = Math.random() * 100 + 'vh'; // Random position
        circle.style.left = Math.random() * 100 + 'vw'; // Random position
        circle.style.animationDuration = `${Math.random() * 3 + 3}s`; // Random duration between 3s and 6s
        document.body.appendChild(circle);
        if (i % 2 === 0) {
            circle.style.backgroundColor = '#24b658';
        }
    }
}

createCircles();
async function handleSubmit(event) {
    const form = document.getElementById('storyForm');
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
            alert("Thank you for sharing your story!");
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