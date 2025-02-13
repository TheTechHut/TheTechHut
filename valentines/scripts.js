document.addEventListener("DOMContentLoaded", function () {
    document.getElementById('valentineform').addEventListener('submit',
        (ev) => handleSubmit(ev, document.getElementById('valentineform'))
    );
});

async function handleSubmit(event, form) {
    event.preventDefault();
    var data = new FormData(event.target);
    fetch(event.target.action, {
        method: form.method,
        body: data,
        headers: {
            'Accept': 'application/json'
        }
    }).then(response => {
        if (response.ok) {
            window.location.href = "./loading.html"
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