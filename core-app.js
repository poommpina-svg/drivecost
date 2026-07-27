(() => {
  const $ = id => document.getElementById(id);
  let mode = "fuel";
  let vehicle = "sedan";
  const vehicleData = {
    sedan:{label:"Sedan 3D • Dark Metallic",image:"/assets/sedan-3d.webp",defaultMode:"fuel",eff:15},
    suv:{label:"SUV 3D • Dark Metallic",image:"/assets/suv-3d.webp",defaultMode:"fuel",eff:10},
    pickup:{label:"Pickup 3D • Dark Metallic",image:"/assets/pickup-3d.webp",defaultMode:"diesel",eff:11},
    van:{label:"Van 3D • Silver Metallic",image:"/assets/van-3d.webp",defaultMode:"diesel",eff:9.5},
    hybrid:{label:"Hybrid 3D • Pearl Silver",image:"/assets/hybrid-3d.webp",defaultMode:"hybrid",eff:22},
    ev:{label:"EV 3D • Pearl White",image:"/assets/ev-3d.webp",defaultMode:"ev",eff:16}
  };
  const energyData = {
    fuel:{types:["เบนซิน 95","แก๊สโซฮอล์ 95","E20","E85"],eff:15,price:42.5,effUnit:"กม./ลิตร",priceUnit:"บาท/ลิตร"},
    diesel:{types:["ดีเซล B7","ดีเซล B10","ดีเซลพรีเมียม"],eff:14,price:33.5,effUnit:"กม./ลิตร",priceUnit:"บาท/ลิตร"},
    lpg:{types:["LPG"],eff:10,price:15.5,effUnit:"กม./ลิตร",priceUnit:"บาท/ลิตร"},
    ngv:{types:["NGV"],eff:12,price:18.8,effUnit:"กม./กก.",priceUnit:"บาท/กก."},
    hybrid:{types:["ไฮบริด เบนซิน","Plug-in Hybrid"],eff:22,price:42.5,effUnit:"กม./ลิตร",priceUnit:"บาท/ลิตร"},
    ev:{types:["ไฟบ้าน","ชาร์จ AC","ชาร์จ DC"],eff:16,price:4.2,effUnit:"kWh/100 กม.",priceUnit:"บาท/kWh"}
  };
  const ids = ["distance","roundTrip","trips","passengers","efficiency","energyPrice","toll","parking","other","wheel","load","tune","traffic","hill","ac"];

  function n(id){ const v=parseFloat($(id).value); return Number.isFinite(v)?v:0; }
  function fmt(v,d=2){ return Number(v||0).toLocaleString("th-TH",{minimumFractionDigits:d,maximumFractionDigits:d}); }
  function toast(msg){ const t=$("toast");t.textContent=msg;t.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove("show"),1600); }

  function setMode(next,syncVehicle=true){
    mode=next;
    window.dispatchEvent(new CustomEvent("drivecost:modechange",{detail:{mode}}));
    document.querySelectorAll("#powerTabs button").forEach(b=>b.classList.toggle("active",b.dataset.mode===mode));
    const d=energyData[mode];
    $("energyType").innerHTML=d.types.map(x=>`<option>${x}</option>`).join("");
    $("efficiency").value=d.eff;
    $("energyPrice").value=d.price;
    $("effUnit").textContent=d.effUnit;
    $("priceUnit").textContent=d.priceUnit;

    if(syncVehicle && (mode==="hybrid" || mode==="ev")){
      setVehicle(mode,false);
      return;
    }
    calculate();
  }

  function setVehicle(next,syncPower=true){
    if(!vehicleData[next]) return;

    const previousVehicle=vehicle;
    vehicle=next;
    const data=vehicleData[vehicle];

    if(previousVehicle!==vehicle){
      window.dispatchEvent(new CustomEvent("drivecost:vehiclechange",{detail:{vehicle}}));
    }

    document.querySelectorAll("#vehicleSelector .vehicle-option").forEach(button=>{
      button.classList.toggle("active",button.dataset.vehicle===vehicle);
    });

    const image=$("vehicleImage");
    const stage=$("vehicleStage");
    const label=$("vehicleLabel");
    const sameVehicle=stage?.dataset.vehicle===vehicle;
    const sameImage=image?.src===data.image || image?.getAttribute("src")===data.image;

    if(label) label.textContent=data.label;

    if(image && (!sameVehicle || !sameImage)){
      image.classList.add("switching");
      const removeSwitching=()=>image.classList.remove("switching");

      setTimeout(()=>{
        if(image.getAttribute("src")!==data.image){
          image.src=data.image;
        }
        if(stage) stage.dataset.vehicle=vehicle;

        if(image.complete){
          removeSwitching();
        }else{
          image.addEventListener("load",removeSwitching,{once:true});
          image.addEventListener("error",removeSwitching,{once:true});
        }
        setTimeout(removeSwitching,450);
      },90);
    }else{
      if(stage) stage.dataset.vehicle=vehicle;
      image?.classList.remove("switching");
    }

    if(syncPower){
      if(mode!==data.defaultMode){
        setMode(data.defaultMode,false);
      }else{
        $("efficiency").value=data.eff;
        calculate();
      }
    }else{
      $("efficiency").value=data.eff;
      calculate();
    }
  }

  function calculate(){
    const distance=Math.max(0,n("distance"));
    const trips=Math.max(1,Math.floor(n("trips")));
    const passengers=Math.max(1,Math.floor(n("passengers")));
    let totalDistance=distance*trips*($("roundTrip").checked?2:1);
    $("totalDistanceInput").value=fmt(totalDistance,0);

    const factors=["wheel","load","tune","traffic","hill","ac"].reduce((s,id)=>s+n(id),0);
    const multiplier=Math.max(.1,1+factors/100);
    $("factorValue").textContent=fmt(multiplier,2)+"×";
    $("factorSub").textContent=(factors>=0?"สิ้นเปลืองเพิ่ม ":"ประหยัดขึ้น ")+fmt(Math.abs(factors),0)+"%";

    let energyUse;
    if(mode==="ev"){
      energyUse=totalDistance*(n("efficiency")/100)*multiplier;
    }else{
      energyUse=(totalDistance/Math.max(.0001,n("efficiency")))*multiplier;
    }
    const energyCost=energyUse*n("energyPrice");
    const toll=Math.max(0,n("toll"));
    const parking=Math.max(0,n("parking"));
    const other=Math.max(0,n("other"));
    const total=energyCost+toll+parking+other;
    const perKm=total/Math.max(1,totalDistance);
    const perPerson=total/passengers;

    $("totalCost").innerHTML=fmt(total,2)+' <span>บาท</span>';
    $("energyUsed").innerHTML=fmt(energyUse,2)+' <em>'+(mode==="ev"?"kWh":mode==="ngv"?"กก.":"ลิตร")+'</em>';
    $("totalDistance").innerHTML=fmt(totalDistance,0)+' <em>กม.</em>';
    $("costPerKm").innerHTML=fmt(perKm,2)+' <em>บาท/กม.</em>';
    $("costPerPerson").innerHTML=fmt(perPerson,2)+' <em>บาท/คน</em>';

    const denom=Math.max(total,.0001);
    const pe=energyCost/denom*100, pt=toll/denom*100, pp=parking/denom*100, po=other/denom*100;
    $("legendEnergy").textContent=fmt(pe,1)+"%";
    $("legendToll").textContent=fmt(pt,1)+"%";
    $("legendParking").textContent=fmt(pp,1)+"%";
    $("legendOther").textContent=fmt(po,1)+"%";
    $("donut").style.background=`conic-gradient(var(--blue) 0 ${pe}%,var(--green) ${pe}% ${pe+pt}%,var(--orange) ${pe+pt}% ${pe+pt+pp}%,#3b82a3 ${pe+pt+pp}% 100%)`;

    const trafficPct=n("traffic");
    const saving=energyCost*(Math.min(trafficPct,10)/Math.max(100+factors,1));
    $("savingValue").textContent=fmt(saving,2)+" บาท";
    $("dateStamp").textContent="คำนวณล่าสุด "+new Date().toLocaleString("th-TH",{dateStyle:"medium",timeStyle:"short"});
    const calculationResult={mode,vehicle,energyType:$("energyType").value,totalDistance,energyUse,energyCost,toll,parking,other,total,perKm,perPerson,multiplier};
    window.dispatchEvent(new CustomEvent("drivecost:calculated",{detail:calculationResult}));
    return calculationResult;
  }

  function snapshot(){
    const data={mode,vehicle,energyType:$("energyType").value};
    ids.forEach(id=>{const el=$(id);data[id]=el.type==="checkbox"?el.checked:el.value});
    return data;
  }

  function save(){
    const list=JSON.parse(localStorage.getItem("drivecost-dark-scenarios")||"[]");
    const result=calculate();
    list.unshift({createdAt:new Date().toISOString(),data:snapshot(),result});
    localStorage.setItem("drivecost-dark-scenarios",JSON.stringify(list.slice(0,30)));
    toast("บันทึกสถานการณ์แล้ว");
  }

  function exportCSV(){
    const r=calculate();
    const rows=[
      ["รายการ","ค่า"],
      ["ประเภทพลังงาน",r.energyType],["ระยะทางรวม",r.totalDistance],["พลังงานที่ใช้",r.energyUse],
      ["ค่าพลังงาน",r.energyCost],["ค่าทางด่วน",r.toll],["ค่าจอดรถ",r.parking],
      ["ค่าใช้จ่ายอื่น",r.other],["ต้นทุนรวม",r.total],["ต้นทุนต่อกม.",r.perKm],["ต้นทุนต่อคน",r.perPerson]
    ];
    const csv="\uFEFF"+rows.map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="drivecost-report.csv";a.click();URL.revokeObjectURL(a.href);
    toast("ส่งออก CSV แล้ว");
  }

  document.querySelectorAll("#vehicleSelector .vehicle-option").forEach(button=>{
    button.addEventListener("click",()=>setVehicle(button.dataset.vehicle));
  });
  document.querySelectorAll("#powerTabs button").forEach(b=>b.addEventListener("click",()=>setMode(b.dataset.mode)));
  ids.forEach(id=>["input","change"].forEach(ev=>$(id).addEventListener(ev,calculate)));
  $("calcBtn").addEventListener("click",()=>{calculate();toast("คำนวณข้อมูลล่าสุดแล้ว")});
  $("saveBtn").addEventListener("click",save);
  $("saveTopBtn").addEventListener("click",save);
  $("csvBtn").addEventListener("click",exportCSV);
  $("shareBtn").addEventListener("click",async()=>{
    const r=calculate();
    const text=`DriveCost: ค่าเดินทางรวม ${fmt(r.total,2)} บาท ระยะทาง ${fmt(r.totalDistance,0)} กม.`;
    if(navigator.share){await navigator.share({title:"DriveCost",text}).catch(()=>{})}
    else{await navigator.clipboard.writeText(text);toast("คัดลอกผลลัพธ์แล้ว")}
  });

  window.DriveCostCore = {
    get mode(){ return mode; },
    get vehicle(){ return vehicle; },
    vehicleData, energyData, ids,
    setMode, setVehicle, calculate, snapshot,
    applyData(data){
      if(!data) return;
      setMode(data.mode || "fuel", false);
      setVehicle(data.vehicle || "sedan", false);
      if(data.energyType !== undefined) $("energyType").value = data.energyType;
      ids.forEach(id => {
        const el = $(id);
        if(!el || data[id] === undefined) return;
        if(el.type === "checkbox") el.checked = Boolean(data[id]);
        else el.value = data[id];
      });
      calculate();
    }
  };

  setMode("fuel",false);
  setVehicle("sedan",false);
  
})();
