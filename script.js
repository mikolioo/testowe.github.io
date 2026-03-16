
function addOpinion(){

const name = document.getElementById("name").value;
const message = document.getElementById("message").value;

if(name === "" || message === ""){
alert("Uzupełnij pola");
return;
}

const div = document.createElement("div");
div.classList.add("opinion");

div.innerHTML = `<p>"${message}"</p><span>- ${name}</span>`;

document.getElementById("opinionsList").appendChild(div);

document.getElementById("name").value="";
document.getElementById("message").value="";
}
