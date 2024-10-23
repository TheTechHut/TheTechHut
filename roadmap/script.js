
document.addEventListener('DOMContentLoaded', () => {

    const addButton = document.querySelector('.add-milestone');
    const body = document.querySelector('body');

    let milestones = [];
    let canvases = [];
    let isDragging = false;
    let currentMilestone = null;

    addButton.addEventListener('click', addMilestone);

    function addMilestone() {
        const milestone = document.createElement('div');
        milestone.classList.add('milestone');
        milestone.textContent = 'Milestone ' + (milestones.length + 1);
        milestone.style.left = '100px';
        milestone.style.top = '100px';
        body.appendChild(milestone);

        const canvas = document.createElement('canvas');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        body.appendChild(canvas);

        milestones.push(milestone);
        canvases.push(canvas);

        if (milestones.length > 1) {
            drawLine(canvases[canvases.length - 2], canvases[canvases.length - 1], milestones[milestones.length - 2], milestone);
        }

        milestone.addEventListener('mousedown', dragStart);
        milestone.addEventListener('mouseup', dragEnd);
    }

    function dragStart(e) {
        isDragging = true;
        currentMilestone = e.target;
    }

    function dragEnd() {
        isDragging = false;
        currentMilestone = null;
    }

    function drawLine(canvas1, canvas2, milestone1, milestone2) {
        const ctx1 = canvas1.getContext('2d');
        const ctx2 = canvas2.getContext('2d');

        const rect1 = milestone1.getBoundingClientRect();
        const rect2 = milestone2.getBoundingClientRect();

        ctx1.beginPath();
        ctx1.moveTo(rect1.x + rect1.width / 2, rect1.y + rect1.height / 2);
        ctx1.lineTo(rect2.x + rect2.width / 2, rect2.y + rect2.height / 2);
        ctx1.stroke();

        ctx2.beginPath();
        ctx2.moveTo(rect1.x + rect1.width / 2, rect1.y + rect1.height / 2);
        ctx2.lineTo(rect2.x + rect2.width / 2, rect2.y + rect2.height / 2);
        ctx2.stroke();
    }

    document.addEventListener('mousemove', (e) => {
        if (isDragging && currentMilestone) {
            currentMilestone.style.left = `${e.clientX - currentMilestone.offsetWidth / 2}px`;
            currentMilestone.style.top = `${e.clientY - currentMilestone.offsetHeight / 2}px`;

            canvases.forEach((canvas, index) => {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                if (index > 0) {
                    drawLine(canvases[index - 1], canvas, milestones[index - 1], milestones[index]);
                }
            });
        }
    });

});
