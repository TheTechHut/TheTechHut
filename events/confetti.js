


const canvas = document.getElementById('confetti');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const particles = [];

function createParticle() {
  const x = Math.random() * canvas.width;
  const y = Math.random() * canvas.height;
  const size = Math.random() * 5 + 2; // Random size
  const speedX = Math.random() * 3 - 1.5; // Random X speed
  const speedY = Math.random() * 3 + 1; // Random Y speed
  const color = `hsl(${Math.random() * 360}, 100%, 50%)`; // Random color

  particles.push({ x, y, size, speedX, speedY, color });
}

function updateParticles() {
  for (let i = 0; i < particles.length; i++) {
    particles[i].x += particles[i].speedX;
    particles[i].y += particles[i].speedY;

    // Remove particles that move off screen
    if (particles[i].y > canvas.height) {
      particles.splice(i, 1);
      i--;
    }
  }
}

function drawParticles() {
  for (let particle of particles) {
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function animate() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  updateParticles();
  drawParticles();
  requestAnimationFrame(animate);
}

function init() {
  for (let i = 0; i < 100; i++) {
    createParticle();
  }
  animate();
}

window.onload = init;
