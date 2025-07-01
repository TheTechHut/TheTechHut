function createCircles() {
    const body = document.querySelector('.circle-parent');
    for (let i = 0; i < 20; i++) {
        const circle = document.createElement('div');
        circle.classList.add('circle');
        const size = Math.random() * 100 + 50; // Random size between 50px and 150px
        circle.style.width = circle.style.height = `${size}px`;
        circle.style.top = Math.random() * 100 + '%'; // Random position
        circle.style.left = Math.random() * 100 + '%'; // Random position
        circle.style.animationDuration = `${Math.random() * 3 + 3}s`; // Random duration between 3s and 6s
        body.appendChild(circle);
        // if (i % 2 === 0) {
        //     circle.style.backgroundColor = '#24b658';
        // }
    }
}

createCircles();