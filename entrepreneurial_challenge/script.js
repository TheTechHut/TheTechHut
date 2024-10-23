{/* <sup className="rounded-full text-xs cursor-pointer [&>*]:!text-white h-4 w-4 px-1 bg-zinc-400 hover:bg-zinc-500 dark:bg-zinc-700 hover:dark:bg-zinc-600">[6](https://dev.to/sameer8saini/countdown-timer-using-html-css-and-javascript-22d3)</sup> */ }

const countdownDate = new Date("Oct 24, 2024 24:00:00").getTime();

const daysElement = document.getElementById("days");
const hoursElement = document.getElementById("hours");
const minutesElement = document.getElementById("minutes");
const secondsElement = document.getElementById("seconds");
let degrees = -45;
const colors = ["#e3242b", "#333", "#e3242b", "#fff", "#2ecc71", "#093e76", "#e3242b", "#333"];
let currentColorIndex = 0;
let nextColorIndex = 1;

const countdownTimer = setInterval(function () {
    const now = new Date().getTime();
    const distance = countdownDate - now;

    const days = String(Math.floor(distance / (1000 * 60 * 60 * 24))).padStart(2, '0');
    const hours = String(Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))).padStart(2, '0');
    const minutes = String(Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60))).padStart(2, '0');
    const seconds = String(Math.floor((distance % (1000 * 60)) / 1000)).padStart(2, '0');

    daysElement.textContent = days;
    hoursElement.textContent = hours;
    minutesElement.textContent = minutes;
    secondsElement.textContent = seconds;

    if (days == "00") {
        document.getElementById("days").style.display = "none";
        document.getElementsByClassName("time-block")[0].style.display = "none";
        document.getElementsByClassName("time-block")[1].style.background = "#e3242b";
        document.getElementsByClassName("time-block")[2].style.background = "#e3242b";
        document.getElementsByClassName("time-block")[3].style.background = "#e3242b";
    }



    if (distance < 0) {
        clearInterval(countdownTimer);
        daysElement.textContent = "00";
        hoursElement.textContent = "00";
        minutesElement.textContent = "00";
        secondsElement.textContent = "00";
    }
}, 1000);



function changeColor() {
    degrees += 10;
    document.getElementsByClassName("container")[0].style.background = "linear-gradient(" + degrees + "deg," + colors[currentColorIndex] + "," + colors[nextColorIndex] + ")";
    currentColorIndex = (currentColorIndex + 1) % colors.length;
    nextColorIndex = (nextColorIndex + 1) % colors.length;
}
setInterval(changeColor(), 200);

