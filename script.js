let opinions=[];
let index=0;

fetch('testimonials.json')
.then(res=>res.json())
.then(data=>{
opinions=data;
render();
setInterval(nextSlide,4000);
});

function render(){

const slides=document.getElementById("slides");
slides.innerHTML="";

opinions.forEach(o=>{

const div=document.createElement("div");
div.className="opinion";

div.innerHTML=`<p>"${o.text}"</p><strong>${o.name}</strong>`;

slides.appendChild(div);

});

}

function nextSlide(){

index++;
if(index>=opinions.length) index=0;

document.getElementById("slides").style.transform=`translateX(-${index*100}%)`;

}
