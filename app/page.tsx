import OriginalPvpLauncher from './original-pvp-launcher';

export default function Home(){
  return (
    <main style={{minHeight:'100vh',background:'#07111f',color:'#f4f7fb',display:'grid',placeItems:'center',padding:'24px'}}>
      <section style={{textAlign:'center'}}>
        <p style={{color:'#9fb0c6'}}>LINE Rangers PvP Statistics</p>
        <OriginalPvpLauncher />
      </section>
    </main>
  );
}
